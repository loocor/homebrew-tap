import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type RequiredAssetKey = "macos-arm64-dmg" | "macos-x64-dmg" | "linux-arm64-appimage" | "linux-x64-appimage";

type Asset = {
  key: RequiredAssetKey;
  platform: "macos" | "linux";
  arch: "arm64" | "x64";
  format: "dmg" | "appimage";
  name: string;
  homebrewUrl: string;
  sha256: string;
};

type ReleaseManifest = {
  schemaVersion: number;
  tag: string;
  version: string;
  assets: Record<string, Asset>;
};

type ManifestFetcher = (input: URL) => Promise<Response>;

const requiredAssets: Record<RequiredAssetKey, Pick<Asset, "platform" | "arch" | "format">> = {
  "macos-arm64-dmg": { platform: "macos", arch: "arm64", format: "dmg" },
  "macos-x64-dmg": { platform: "macos", arch: "x64", format: "dmg" },
  "linux-arm64-appimage": { platform: "linux", arch: "arm64", format: "appimage" },
  "linux-x64-appimage": { platform: "linux", arch: "x64", format: "appimage" },
};

const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const sha256 = /^[a-fA-F0-9]{64}$/;
const safeBasename = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const homebrewOrigin = "https://public.mcp.umate.ai";

function fail(message: string): never {
  throw new Error(message);
}

function parseSource(arguments_: string[]): { type: "file" | "url"; value: string } {
  if (arguments_.length !== 2) {
    fail("Provide exactly one source: --manifest-file <path> or --manifest-url <https-url>");
  }

  const [flag, value] = arguments_;
  if ((flag !== "--manifest-file" && flag !== "--manifest-url") || !value || value.startsWith("--")) {
    fail("Provide exactly one source: --manifest-file <path> or --manifest-url <https-url>");
  }

  if (flag === "--manifest-url") {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      fail("Manifest URL must be an HTTPS URL");
    }
    if (url.protocol !== "https:") {
      fail("Manifest URL must be an HTTPS URL");
    }
    return { type: "url", value: url.toString() };
  }

  return { type: "file", value };
}

function parseManifest(source: string): ReleaseManifest {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    fail("Manifest must contain valid JSON");
  }
  if (!value || typeof value !== "object") {
    fail("Manifest must be an object");
  }

  const manifest = value as Partial<ReleaseManifest>;
  if (manifest.schemaVersion !== 2) {
    fail("Manifest schemaVersion must be 2");
  }
  if (typeof manifest.version !== "string" || !semver.test(manifest.version)) {
    fail("Manifest version must be a semver-style version");
  }
  if (typeof manifest.tag !== "string" || manifest.tag !== `v${manifest.version}` || !/^v/.test(manifest.tag)) {
    fail("Manifest tag must exactly match the full version with a v prefix");
  }
  if (!manifest.assets || typeof manifest.assets !== "object") {
    fail("Manifest assets must be an object");
  }

  const normalizedAssets: Partial<Record<RequiredAssetKey, Asset>> = {};
  for (const [key, expected] of Object.entries(requiredAssets) as [RequiredAssetKey, (typeof requiredAssets)[RequiredAssetKey]][]) {
    const asset = manifest.assets[key];
    if (!asset || typeof asset !== "object") {
      fail(`Manifest is missing required asset: ${key}`);
    }
    if (asset.key !== key || asset.platform !== expected.platform || asset.arch !== expected.arch || asset.format !== expected.format) {
      fail(`Manifest asset metadata is invalid: ${key}`);
    }
    if (typeof asset.name !== "string" || typeof asset.homebrewUrl !== "string" || typeof asset.sha256 !== "string") {
      fail(`Manifest asset is incomplete: ${key}`);
    }
    const expectedExtension = expected.format === "appimage" ? ".AppImage" : ".dmg";
    if (!safeBasename.test(asset.name) || !asset.name.endsWith(expectedExtension)) {
      fail(`Manifest asset name must be a safe basename: ${key}`);
    }

    let assetUrl: URL;
    try {
      assetUrl = new URL(asset.homebrewUrl);
    } catch {
      fail(`Manifest homebrewUrl is invalid: ${key}`);
    }
    const expectedPathname = `/downloads/homebrew/${encodeURIComponent(manifest.tag)}/${key}`;
    if (
      asset.homebrewUrl !== assetUrl.toString() ||
      assetUrl.origin !== homebrewOrigin ||
      assetUrl.username ||
      assetUrl.password ||
      assetUrl.search ||
      assetUrl.hash ||
      assetUrl.pathname !== expectedPathname
    ) {
      fail(`Manifest homebrewUrl must be canonical: ${key}`);
    }
    if (!sha256.test(asset.sha256)) {
      fail(`Manifest sha256 must be 64 hexadecimal characters: ${key}`);
    }
    normalizedAssets[key] = { ...asset, homebrewUrl: assetUrl.toString() };
  }

  return { ...manifest, assets: normalizedAssets as Record<RequiredAssetKey, Asset> } as ReleaseManifest;
}

function renderAsset(asset: Asset): string {
  return `      sha256 "${asset.sha256}"\n      url "${asset.homebrewUrl}"`;
}

function renderAppImage(asset: Asset): string {
  return `      app_image "${asset.name}", target: "MCPMate.AppImage"`;
}

function renderCask(manifest: ReleaseManifest): string {
  const macosArm = renderAsset(manifest.assets["macos-arm64-dmg"]);
  const macosX64 = renderAsset(manifest.assets["macos-x64-dmg"]);
  const linuxArm = renderAsset(manifest.assets["linux-arm64-appimage"]);
  const linuxX64 = renderAsset(manifest.assets["linux-x64-appimage"]);
  const linuxArmAppImage = renderAppImage(manifest.assets["linux-arm64-appimage"]);
  const linuxX64AppImage = renderAppImage(manifest.assets["linux-x64-appimage"]);

  return `# frozen_string_literal: true

cask "mcpmate@beta" do
  version "${manifest.version}"

  name "MCPMate"
  desc "MCP server management and operations workspace"
  homepage "https://mcpmate.ai/"

  on_macos do
    on_arm do
${macosArm}
    end
    on_intel do
${macosX64}
    end

    app "MCPMate.app"
  end

  on_linux do
    on_arm do
${linuxArm}
${linuxArmAppImage}
    end
    on_intel do
${linuxX64}
${linuxX64AppImage}
    end
  end

  caveats <<~EOS
    MCPMate is a Beta release for macOS and Linux on arm64 and x64.
    Linux AppImage installation requires Homebrew 5.1.12 or later.
    Exit the MCPMate app and any MCPMate service normally before uninstalling.
    Uninstall does not terminate services or remove ~/.mcpmate, including logs,
    databases, and user configuration.
  EOS
end
`;
}

async function fetchManifest(url: string, fetcher: ManifestFetcher): Promise<string> {
  try {
    const response = await fetcher(new URL(url));
    if (!response.ok) {
      fail(`Unable to fetch manifest: HTTP ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unable to fetch manifest:")) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    fail(`Unable to fetch manifest: ${detail}`);
  }
}

export async function updateCask(arguments_: string[], fetcher: ManifestFetcher = fetch): Promise<void> {
  const source = parseSource(arguments_);
  const manifestText = source.type === "file" ? await readFile(source.value, "utf8") : await fetchManifest(source.value, fetcher);
  const cask = renderCask(parseManifest(manifestText));
  await writeFile(join(import.meta.dir, "..", "Casks", "mcpmate@beta.rb"), cask);
}

if (import.meta.main) {
  updateCask(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

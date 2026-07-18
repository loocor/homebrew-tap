import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  homebrewOrigin,
  manifestPathPrefix,
  parseReleaseTag,
  releaseManifestUrl,
  type ReleaseChannel,
} from "./release-contract";

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
  schemaVersion: 2;
  tag: string;
  version: string;
  releaseChannel: ReleaseChannel;
  assets: Record<string, Asset>;
};

export type ReleaseTarget = {
  releaseChannel: ReleaseChannel;
  tag: string;
  version: string;
  caskToken: "mcpmate" | "mcpmate@beta";
  caskPath: "Casks/mcpmate.rb" | "Casks/mcpmate@beta.rb";
};

type ManifestFetcher = (input: URL) => Promise<Response>;
type ManifestSource = { type: "file"; value: string } | { type: "url"; value: string; tag: string };

const requiredAssets: Record<RequiredAssetKey, Pick<Asset, "platform" | "arch" | "format">> = {
  "macos-arm64-dmg": { platform: "macos", arch: "arm64", format: "dmg" },
  "macos-x64-dmg": { platform: "macos", arch: "x64", format: "dmg" },
  "linux-arm64-appimage": { platform: "linux", arch: "arm64", format: "appimage" },
  "linux-x64-appimage": { platform: "linux", arch: "x64", format: "appimage" },
};

const sha256 = /^[a-f0-9]{64}$/;
const safeBasename = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const releaseTargets: Record<ReleaseChannel, Pick<ReleaseTarget, "caskToken" | "caskPath">> = {
  stable: { caskToken: "mcpmate", caskPath: "Casks/mcpmate.rb" },
  beta: { caskToken: "mcpmate@beta", caskPath: "Casks/mcpmate@beta.rb" },
};

function fail(message: string): never {
  throw new Error(message);
}

function parseSource(arguments_: string[]): ManifestSource {
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
    const tag = url.pathname.startsWith(manifestPathPrefix) ? url.pathname.slice(manifestPathPrefix.length) : "";
    if (
      value !== url.toString() ||
      url.origin !== homebrewOrigin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !parseReleaseTag(tag) ||
      value !== releaseManifestUrl(tag)
    ) {
      fail("Manifest URL must be canonical: https://public.mcp.umate.ai/downloads/releases/<tag>");
    }
    return { type: "url", value: url.toString(), tag };
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
  if (manifest.releaseChannel !== "stable" && manifest.releaseChannel !== "beta") {
    fail('Manifest releaseChannel must be "stable" or "beta"');
  }
  const tagChannel = typeof manifest.tag === "string" ? parseReleaseTag(manifest.tag) : null;
  if (!tagChannel) {
    fail("Manifest tag must be a supported stable or beta release tag");
  }
  if (typeof manifest.version !== "string" || manifest.tag !== `v${manifest.version}`) {
    fail("Manifest tag must exactly match the full version with a v prefix");
  }
  if (manifest.releaseChannel !== tagChannel) {
    fail("Manifest releaseChannel does not match the release tag");
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
      fail(`Manifest sha256 must be 64 lowercase hexadecimal characters: ${key}`);
    }
    normalizedAssets[key] = { ...asset, homebrewUrl: assetUrl.toString() };
  }

  return { ...manifest, assets: normalizedAssets as Record<RequiredAssetKey, Asset> } as ReleaseManifest;
}

function renderAsset(asset: Asset, version: string): string {
  const versionedUrl = asset.homebrewUrl.replace(`/v${version}/`, "/v#{version}/");
  return `      sha256 "${asset.sha256}"\n      url "${versionedUrl}", verified: "mcp.umate.ai"`;
}

function renderAppImage(asset: Asset): string {
  return `      app_image "${asset.name}", target: "MCPMate.AppImage"`;
}

function releaseTarget(manifest: ReleaseManifest): ReleaseTarget {
  return {
    releaseChannel: manifest.releaseChannel,
    tag: manifest.tag,
    version: manifest.version,
    ...releaseTargets[manifest.releaseChannel],
  };
}

function renderCask(manifest: ReleaseManifest, target: ReleaseTarget): string {
  const macosArm = renderAsset(manifest.assets["macos-arm64-dmg"], manifest.version);
  const macosX64 = renderAsset(manifest.assets["macos-x64-dmg"], manifest.version);
  const linuxArm = renderAsset(manifest.assets["linux-arm64-appimage"], manifest.version);
  const linuxX64 = renderAsset(manifest.assets["linux-x64-appimage"], manifest.version);
  const linuxArmAppImage = renderAppImage(manifest.assets["linux-arm64-appimage"]);
  const linuxX64AppImage = renderAppImage(manifest.assets["linux-x64-appimage"]);

  return `# frozen_string_literal: true

cask "${target.caskToken}" do
  version "${manifest.version}"

  name "MCPMate"
  desc "${target.releaseChannel === "beta" ? "Beta channel for MCP server management and operations" : "MCP server management and operations workspace"}"
  homepage "https://mcpmate.ai/"

  conflicts_with cask: "${target.releaseChannel === "beta" ? "mcpmate" : "mcpmate@beta"}"

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
    MCPMate ${target.releaseChannel === "beta" ? "Beta" : "Stable"} supports macOS and Linux on arm64 and x64.
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

export async function updateCask(arguments_: string[], fetcher: ManifestFetcher = fetch): Promise<ReleaseTarget> {
  const source = parseSource(arguments_);
  const manifestText = source.type === "file" ? await readFile(source.value, "utf8") : await fetchManifest(source.value, fetcher);
  const manifest = parseManifest(manifestText);
  if (source.type === "url" && source.tag !== manifest.tag) {
    fail("Manifest URL tag must exactly match the manifest tag");
  }
  const target = releaseTarget(manifest);
  const cask = renderCask(manifest, target);
  await writeFile(join(import.meta.dir, "..", target.caskPath), cask);
  return target;
}

if (import.meta.main) {
  updateCask(process.argv.slice(2))
    .then((target) => console.log(JSON.stringify(target)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

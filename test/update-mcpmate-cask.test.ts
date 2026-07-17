import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateCask } from "../scripts/update-mcpmate-cask";

const repositoryRoot = join(import.meta.dir, "..");
const fixturePath = join(import.meta.dir, "fixtures", "release-manifest-v2.json");
const caskPath = join(repositoryRoot, "Casks", "mcpmate@beta.rb");
const temporaryDirectories: string[] = [];
let originalCask = "";

beforeAll(async () => { originalCask = await readFile(caskPath, "utf8"); });
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  await writeFile(caskPath, originalCask);
});
afterAll(async () => { await writeFile(caskPath, originalCask); });

async function runUpdater(...arguments_: string[]) {
  const process = Bun.spawn(["bun", "scripts/update-mcpmate-cask.ts", ...arguments_], { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
  return { exitCode: await process.exited, stderr: await new Response(process.stderr).text() };
}

async function temporaryManifest(transform: (manifest: Record<string, unknown>) => void): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "mcpmate-cask-test-"));
  temporaryDirectories.push(directory);
  const manifest = JSON.parse(await readFile(fixturePath, "utf8"));
  transform(manifest);
  const path = join(directory, "manifest.json");
  await writeFile(path, `${JSON.stringify(manifest)}\n`);
  return path;
}

describe("update-mcpmate-cask", () => {
  test("renders complete version, exact asset URLs and real digests", async () => {
    expect((await runUpdater("--manifest-file", fixturePath)).exitCode).toBe(0);
    const cask = await readFile(caskPath, "utf8");
    expect(cask).toContain('version "0.3.4-beta"');
    expect(cask).toContain("on_macos do"); expect(cask).toContain("on_linux do");
    for (const [key, digest] of Object.entries({ "macos-arm64-dmg": "8f8f1c283e53d955b0da33d74afdde9bc30e92f6fc3114a18d2ebf6d75d29ce1", "macos-x64-dmg": "2c32b23fccd61a9c67769e837d763dee8efddb0be45c95290fdeec2c9e4eb3be", "linux-arm64-appimage": "25ec91d39a54d7bb5a9c63dda4f72335e9e6283a2693b0bc0e8bb103b0b8bff2", "linux-x64-appimage": "0295911991747e766cd3441f26dc9cd89c58fcf45018fd4ca1242c8277952f13" })) {
      expect(cask).toContain(`url "https://public.mcp.umate.ai/downloads/homebrew/v0.3.4-beta/${key}"`);
      expect(cask).toContain(`sha256 "${digest}"`);
    }
  });
  test("uses official AppImage source and a stable Linux target", async () => {
    expect((await runUpdater("--manifest-file", fixturePath)).exitCode).toBe(0);
    const cask = await readFile(caskPath, "utf8");
    expect(cask).toContain('app "MCPMate.app"');
    expect(cask).toContain('app_image "MCPMate_0.3.4_linux_arm64.AppImage", target: "MCPMate.AppImage"');
    expect(cask).toContain('app_image "MCPMate_0.3.4_linux_x64.AppImage", target: "MCPMate.AppImage"');
    expect(cask).toContain("Homebrew 5.1.12 or later");
  });
  test("binds each AppImage source to its selected Linux architecture", async () => {
    expect((await runUpdater("--manifest-file", fixturePath)).exitCode).toBe(0);
    const cask = await readFile(caskPath, "utf8");
    const linux = cask.split("  on_linux do\n")[1].split("\n  caveats")[0];
    const arm = linux.split("    on_arm do\n")[1].split("    end\n    on_intel")[0];
    const intel = linux.split("    on_intel do\n")[1].split("    end\n")[0];
    expect(arm).toContain('url "https://public.mcp.umate.ai/downloads/homebrew/v0.3.4-beta/linux-arm64-appimage"');
    expect(arm).toContain('app_image "MCPMate_0.3.4_linux_arm64.AppImage", target: "MCPMate.AppImage"');
    expect(intel).toContain('url "https://public.mcp.umate.ai/downloads/homebrew/v0.3.4-beta/linux-x64-appimage"');
    expect(intel).toContain('app_image "MCPMate_0.3.4_linux_x64.AppImage", target: "MCPMate.AppImage"');
  });
  test("does not add forbidden fallback or lifecycle artifacts", async () => {
    expect((await runUpdater("--manifest-file", fixturePath)).exitCode).toBe(0);
    const cask = await readFile(caskPath, "utf8");
    expect(cask).not.toContain("sha256 :no_check"); expect(cask).not.toContain("container type: :naked");
    expect(cask).not.toMatch(/^\s*binary\b/m); expect(cask).not.toMatch(/^\s*(service|zap)\b/m); expect(cask).not.toMatch(/\b(killall|pkill)\b/);
  });
  test("supports manifest URL mode without any alternate source", async () => {
    let requestedUrl = "";
    await updateCask(["--manifest-url", "https://admin.example.test/releases/v0.3.4-beta.json"], async (url) => { requestedUrl = url.toString(); return new Response(Bun.file(fixturePath)); });
    expect(requestedUrl).toBe("https://admin.example.test/releases/v0.3.4-beta.json"); expect(await readFile(caskPath, "utf8")).toContain('version "0.3.4-beta"');
  });
  test("rejects missing, conflicting, and malformed CLI sources with diagnostics", async () => {
    expect((await runUpdater()).stderr).toContain("Provide exactly one source"); expect((await runUpdater("--manifest-file", fixturePath, "--manifest-url", "https://example.test/manifest.json")).stderr).toContain("Provide exactly one source"); expect((await runUpdater("--manifest-url", "ftp://example.test/manifest.json")).stderr).toContain("Manifest URL must be an HTTPS URL");
  });
  test("fails loudly when manifest URL fetching fails", async () => {
    await expect(updateCask(["--manifest-url", "https://admin.example.test/releases/v0.3.4-beta.json"], async () => { throw new Error("connection refused"); })).rejects.toThrow("Unable to fetch manifest");
  });
  test("rejects an unsupported schema version with a diagnostic", async () => { const path = await temporaryManifest((manifest) => { manifest.schemaVersion = 3; }); expect((await runUpdater("--manifest-file", path)).stderr).toContain("Manifest schemaVersion must be 2"); });
  test("rejects a missing required asset with a diagnostic", async () => { const path = await temporaryManifest((manifest) => { delete (manifest.assets as Record<string, unknown>)["linux-x64-appimage"]; }); expect((await runUpdater("--manifest-file", path)).stderr).toContain("Manifest is missing required asset: linux-x64-appimage"); });
  test("rejects invalid asset digests with a diagnostic", async () => { const path = await temporaryManifest((manifest) => { ((manifest.assets as Record<string, Record<string, string>>)["macos-arm64-dmg"]).sha256 = "not-a-digest"; }); expect((await runUpdater("--manifest-file", path)).stderr).toContain("Manifest sha256 must be 64 hexadecimal characters: macos-arm64-dmg"); });
  test("rejects tag and version mismatches with a diagnostic", async () => { const path = await temporaryManifest((manifest) => { manifest.tag = "v0.3.5-beta"; }); expect((await runUpdater("--manifest-file", path)).stderr).toContain("Manifest tag must exactly match the full version with a v prefix"); });
  test("rejects invalid required asset metadata with a diagnostic", async () => { const path = await temporaryManifest((manifest) => { ((manifest.assets as Record<string, Record<string, string>>)["linux-arm64-appimage"]).format = "deb"; }); expect((await runUpdater("--manifest-file", path)).stderr).toContain("Manifest asset metadata is invalid: linux-arm64-appimage"); });
  test.each([["GitHub origin", "https://github.com/loocor/mcpmate/releases/download/v0.3.4-beta/MCPMate_0.3.4_macos_aarch64.dmg"], ["latest route", "https://public.mcp.umate.ai/downloads/homebrew/latest/macos-arm64-dmg"], ["wrong asset key", "https://public.mcp.umate.ai/downloads/homebrew/v0.3.4-beta/macos-x64-dmg"], ["query", "https://public.mcp.umate.ai/downloads/homebrew/v0.3.4-beta/macos-arm64-dmg?download=1"], ["credentials", "https://token@public.mcp.umate.ai/downloads/homebrew/v0.3.4-beta/macos-arm64-dmg"], ["fragment", "https://public.mcp.umate.ai/downloads/homebrew/v0.3.4-beta/macos-arm64-dmg#fragment"], ["Ruby injection", "https://public.mcp.umate.ai/downloads/homebrew/v0.3.4-beta/macos-arm64-dmg\"\n  zap"]])("rejects a non-canonical homebrewUrl: %s", async (_case, url) => {
    const path = await temporaryManifest((manifest) => { ((manifest.assets as Record<string, Record<string, string>>)["macos-arm64-dmg"]).homebrewUrl = url; }); expect((await runUpdater("--manifest-file", path)).stderr).toContain("Manifest homebrewUrl must be canonical: macos-arm64-dmg");
  });
  test("rejects unsafe AppImage asset basenames with a diagnostic", async () => { const path = await temporaryManifest((manifest) => { ((manifest.assets as Record<string, Record<string, string>>)["linux-arm64-appimage"]).name = "../MCPMate.AppImage"; }); expect((await runUpdater("--manifest-file", path)).stderr).toContain("Manifest asset name must be a safe basename: linux-arm64-appimage"); });
  test("is byte-identical when run twice with the same manifest", async () => { expect((await runUpdater("--manifest-file", fixturePath)).exitCode).toBe(0); const first = await readFile(caskPath, "utf8"); expect((await runUpdater("--manifest-file", fixturePath)).exitCode).toBe(0); expect(await readFile(caskPath, "utf8")).toBe(first); });
  test("restores the tracked Cask after integration tests", async () => { expect(await readFile(caskPath, "utf8")).toBe(originalCask); });
});

import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
	test,
} from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { updateCask } from "../scripts/update-mcpmate-cask";

const repositoryRoot = join(import.meta.dir, "..");
const fixturePath = join(
	import.meta.dir,
	"fixtures",
	"release-manifest-v2.json",
);
const betaCaskPath = join(repositoryRoot, "Casks", "mcpmate@beta.rb");
const stableCaskPath = join(repositoryRoot, "Casks", "mcpmate.rb");
const temporaryDirectories: string[] = [];
let originalCask = "";
let originalStableCask: string | null = null;

type FixtureAsset = {
	key: string;
	name: string;
	homebrewUrl: string;
	sha256: string;
	format: string;
};

beforeAll(async () => {
	originalCask = await readFile(betaCaskPath, "utf8");
	originalStableCask = (await Bun.file(stableCaskPath).exists())
		? await readFile(stableCaskPath, "utf8")
		: null;
});
afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
	if (originalStableCask === null) await rm(stableCaskPath, { force: true });
	else await writeFile(stableCaskPath, originalStableCask);
	await writeFile(betaCaskPath, originalCask);
});
afterAll(async () => {
	if (originalStableCask === null) await rm(stableCaskPath, { force: true });
	else await writeFile(stableCaskPath, originalStableCask);
	await writeFile(betaCaskPath, originalCask);
});

async function runUpdater(...arguments_: string[]) {
	const process = Bun.spawn(
		["bun", "scripts/update-mcpmate-cask.ts", ...arguments_],
		{ cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" },
	);
	return {
		exitCode: await process.exited,
		stderr: await new Response(process.stderr).text(),
	};
}

async function temporaryManifest(
	transform: (manifest: Record<string, unknown>) => void,
): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "mcpmate-cask-test-"));
	temporaryDirectories.push(directory);
	const manifest = JSON.parse(await readFile(fixturePath, "utf8"));
	transform(manifest);
	const path = join(directory, "manifest.json");
	await writeFile(path, `${JSON.stringify(manifest)}\n`);
	return path;
}

function fixtureAsset(
	manifest: Record<string, unknown>,
	key: string,
): FixtureAsset {
	const assets = manifest.assets;
	if (!assets || typeof assets !== "object")
		throw new Error("Fixture assets must be an object");
	const asset = (assets as Record<string, unknown>)[key];
	if (!asset || typeof asset !== "object")
		throw new Error(`Fixture asset is missing: ${key}`);
	return asset as FixtureAsset;
}

function textBetween(source: string, start: string, end: string): string {
	const startIndex = source.indexOf(start);
	if (startIndex === -1) throw new Error(`Missing section start: ${start}`);
	const contentStart = startIndex + start.length;
	const endIndex = source.indexOf(end, contentStart);
	if (endIndex === -1) throw new Error(`Missing section end: ${end}`);
	return source.slice(contentStart, endIndex);
}

async function releaseManifest(
	version: string,
	releaseChannel: string,
	options: { encodedTag?: boolean } = {},
): Promise<string> {
	return temporaryManifest((manifest) => {
		const tag = `v${version}`;
		const tagPath = options.encodedTag ? encodeURIComponent(tag) : tag;
		manifest.tag = tag;
		manifest.version = version;
		manifest.releaseChannel = releaseChannel;
		for (const asset of Object.values(
			manifest.assets as Record<string, FixtureAsset>,
		)) {
			asset.name = asset.name.replace("0.3.4", version.replace(/[-+].*$/, ""));
			asset.homebrewUrl = `https://public.mcp.umate.ai/downloads/homebrew/${tagPath}/${asset.key}`;
		}
	});
}

describe("update-mcpmate-cask", () => {
	test("renders complete version, exact asset URLs and real digests", async () => {
		expect((await runUpdater("--manifest-file", fixturePath)).exitCode).toBe(0);
		const cask = await readFile(betaCaskPath, "utf8");
		expect(cask).toContain('version "0.3.4-beta"');
		expect(cask).toContain("on_macos do");
		expect(cask).toContain("on_linux do");
		for (const [key, digest] of Object.entries({
			"macos-arm64-dmg":
				"8f8f1c283e53d955b0da33d74afdde9bc30e92f6fc3114a18d2ebf6d75d29ce1",
			"macos-x64-dmg":
				"2c32b23fccd61a9c67769e837d763dee8efddb0be45c95290fdeec2c9e4eb3be",
			"linux-arm64-appimage":
				"25ec91d39a54d7bb5a9c63dda4f72335e9e6283a2693b0bc0e8bb103b0b8bff2",
			"linux-x64-appimage":
				"0295911991747e766cd3441f26dc9cd89c58fcf45018fd4ca1242c8277952f13",
		})) {
			expect(cask).toContain(
				`url "https://public.mcp.umate.ai/downloads/homebrew/v#{version}/${key}"`,
			);
			expect(cask).toContain(`sha256 "${digest}"`);
		}
	});
	test("uses official AppImage source and a stable Linux target", async () => {
		expect((await runUpdater("--manifest-file", fixturePath)).exitCode).toBe(0);
		const cask = await readFile(betaCaskPath, "utf8");
		expect(cask).toContain('app "MCPMate.app"');
		expect(cask).toContain(
			'app_image "MCPMate_0.3.4_linux_arm64.AppImage", target: "MCPMate.AppImage"',
		);
		expect(cask).toContain(
			'app_image "MCPMate_0.3.4_linux_x64.AppImage", target: "MCPMate.AppImage"',
		);
		expect(cask).toContain("Homebrew 5.1.12 or later");
	});
	test("renders the canonical product homepage and product-level caveat", async () => {
		expect((await runUpdater("--manifest-file", fixturePath)).exitCode).toBe(0);
		const cask = await readFile(betaCaskPath, "utf8");
		expect(cask).toContain('homepage "https://mcp.umate.ai/"');
		expect(cask).toContain(
			"MCPMate supports macOS and Linux on arm64 and x64.",
		);
		expect(cask).not.toContain(
			"MCPMate Beta supports macOS and Linux on arm64 and x64.",
		);
		expect(cask).not.toContain('homepage "https://mcpmate.ai/"');
	});
	test("omits redundant URL verification for the shared homepage domain", async () => {
		expect((await runUpdater("--manifest-file", fixturePath)).exitCode).toBe(0);
		expect(await readFile(betaCaskPath, "utf8")).not.toContain("verified:");
	});
	test("renders a Beta-only GitHub Releases livecheck", async () => {
		expect((await runUpdater("--manifest-file", fixturePath)).exitCode).toBe(0);
		const cask = await readFile(betaCaskPath, "utf8");
		expect(cask).toContain('url "https://github.com/loocor/mcpmate"');
		expect(cask).toContain(
			"regex(/^v((?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)-beta(?:\\.(?:0|[1-9]\\d*))?)$/)",
		);
		expect(cask).not.toContain("regex(/^v?(");
		expect(cask).not.toMatch(/^\s*regex\(.+\/i\)$/m);
		expect(cask).toContain("strategy :github_releases do |json, regex|");
	});
	test("uses core Ruby truthiness for livecheck matches", async () => {
		expect((await runUpdater("--manifest-file", fixturePath)).exitCode).toBe(0);
		const cask = await readFile(betaCaskPath, "utf8");
		expect(cask).toContain("next unless match");
		expect(cask).not.toContain("match.blank?");
		expect(cask).not.toContain("end.compact");
	});
	test("binds each AppImage source to its selected Linux architecture", async () => {
		expect((await runUpdater("--manifest-file", fixturePath)).exitCode).toBe(0);
		const cask = await readFile(betaCaskPath, "utf8");
		const linux = textBetween(cask, "  on_linux do\n", "\n  caveats");
		const arm = textBetween(linux, "    on_arm do\n", "    end\n    on_intel");
		const intel = textBetween(linux, "    on_intel do\n", "    end\n");
		expect(arm).toContain(
			'url "https://public.mcp.umate.ai/downloads/homebrew/v#{version}/linux-arm64-appimage"',
		);
		expect(arm).toContain(
			'app_image "MCPMate_0.3.4_linux_arm64.AppImage", target: "MCPMate.AppImage"',
		);
		expect(intel).toContain(
			'url "https://public.mcp.umate.ai/downloads/homebrew/v#{version}/linux-x64-appimage"',
		);
		expect(intel).toContain(
			'app_image "MCPMate_0.3.4_linux_x64.AppImage", target: "MCPMate.AppImage"',
		);
	});
	test("does not add forbidden fallback or lifecycle artifacts", async () => {
		expect((await runUpdater("--manifest-file", fixturePath)).exitCode).toBe(0);
		const cask = await readFile(betaCaskPath, "utf8");
		expect(cask).not.toContain("sha256 :no_check");
		expect(cask).not.toContain("container type: :naked");
		expect(cask).not.toMatch(/^\s*binary\b/m);
		expect(cask).not.toMatch(/^\s*(service|zap)\b/m);
		expect(cask).not.toMatch(/\b(killall|pkill)\b/);
	});
	test("supports manifest URL mode without any alternate source", async () => {
		let requestedUrl = "";
		await updateCask(
			[
				"--manifest-url",
				"https://public.mcp.umate.ai/downloads/releases/v0.3.4-beta",
			],
			async (url) => {
				requestedUrl = url.toString();
				return new Response(Bun.file(fixturePath));
			},
		);
		expect(requestedUrl).toBe(
			"https://public.mcp.umate.ai/downloads/releases/v0.3.4-beta",
		);
		expect(await readFile(betaCaskPath, "utf8")).toContain(
			'version "0.3.4-beta"',
		);
	});

	test("derives the beta target from a validated beta manifest", async () => {
		const target = await updateCask(["--manifest-file", fixturePath]);
		expect(target).toEqual({
			releaseChannel: "beta",
			tag: "v0.3.4-beta",
			version: "0.3.4-beta",
			caskToken: "mcpmate@beta",
			caskPath: "Casks/mcpmate@beta.rb",
		});
		expect(await readFile(betaCaskPath, "utf8")).toContain(
			'cask "mcpmate@beta" do',
		);
	});

	test("derives the stable target and creates the first stable Cask only for a stable manifest", async () => {
		const path = await releaseManifest("1.2.3", "stable");
		const target = await updateCask(["--manifest-file", path]);
		expect(target).toEqual({
			releaseChannel: "stable",
			tag: "v1.2.3",
			version: "1.2.3",
			caskToken: "mcpmate",
			caskPath: "Casks/mcpmate.rb",
		});
		const cask = await readFile(stableCaskPath, "utf8");
		expect(cask).toContain('cask "mcpmate" do');
		expect(cask).toContain('version "1.2.3"');
		expect(cask).toContain('url "https://github.com/loocor/mcpmate"');
		expect(cask).toContain(
			"regex(/^v((?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*))$/)",
		);
		expect(cask).not.toContain(
			"regex(/^v((?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)-beta",
		);
	});

	test("does not create a placeholder stable Cask for a beta manifest", async () => {
		expect((await runUpdater("--manifest-file", fixturePath)).exitCode).toBe(0);
		if (originalStableCask === null)
			await expect(Bun.file(stableCaskPath).exists()).resolves.toBe(false);
		else
			expect(await readFile(stableCaskPath, "utf8")).toBe(originalStableCask);
	});

	test("accepts only beta and beta numeric prerelease tags for the beta channel", async () => {
		for (const version of ["1.2.3-beta", "1.2.3-beta.7"]) {
			const path = await releaseManifest(version, "beta");
			expect((await runUpdater("--manifest-file", path)).exitCode).toBe(0);
			expect(await readFile(betaCaskPath, "utf8")).toContain(
				`version "${version}"`,
			);
		}
	});

	test.each([
		["stable tag with beta channel", "1.2.3", "beta"],
		["beta tag with stable channel", "1.2.3-beta", "stable"],
	])("rejects a channel mismatch: %s", async (_case, version, channel) => {
		const path = await releaseManifest(version, channel);
		expect((await runUpdater("--manifest-file", path)).stderr).toContain(
			"Manifest releaseChannel does not match the release tag",
		);
	});

	test.each([
		"alpha",
		"rc.1",
		"dev",
		"debug",
		"nightly",
		"preview.1",
		"beta.preview",
	])("rejects an unsupported prerelease suffix: %s", async (suffix) => {
		const path = await releaseManifest(`1.2.3-${suffix}`, "beta");
		expect((await runUpdater("--manifest-file", path)).stderr).toContain(
			"Manifest tag must be a supported stable or beta release tag",
		);
	});

	test.each(["01.2.3", "1.02.3", "1.2.03", "1.2.3-beta.01"])(
		"rejects malformed SemVer: %s",
		async (version) => {
			const path = await releaseManifest(
				version,
				version.includes("beta") ? "beta" : "stable",
			);
			expect((await runUpdater("--manifest-file", path)).stderr).toContain(
				"Manifest tag must be a supported stable or beta release tag",
			);
		},
	);

	test.each([
		["literal plus", false],
		["encoded plus", true],
	])(
		"rejects SemVer build metadata in tag and URLs: %s",
		async (_case, encodedTag) => {
			const path = await releaseManifest("1.2.3-beta+build.1", "beta", {
				encodedTag,
			});
			expect((await runUpdater("--manifest-file", path)).stderr).toContain(
				"Manifest tag must be a supported stable or beta release tag",
			);
		},
	);

	test("rejects a releaseChannel outside the supported manifest contract", async () => {
		const path = await releaseManifest("1.2.3", "nightly");
		expect((await runUpdater("--manifest-file", path)).stderr).toContain(
			'Manifest releaseChannel must be "stable" or "beta"',
		);
	});
	test("rejects missing, conflicting, and malformed CLI sources with diagnostics", async () => {
		expect((await runUpdater()).stderr).toContain("Provide exactly one source");
		expect(
			(
				await runUpdater(
					"--manifest-file",
					fixturePath,
					"--manifest-url",
					"https://example.test/manifest.json",
				)
			).stderr,
		).toContain("Provide exactly one source");
		expect(
			(await runUpdater("--manifest-url", "ftp://example.test/manifest.json"))
				.stderr,
		).toContain("Manifest URL must be an HTTPS URL");
	});
	test.each([
		[
			"GitHub manifest origin",
			"https://github.com/loocor/mcpmate/releases/download/v0.3.4-beta/update.json",
		],
		[
			"latest release route",
			"https://public.mcp.umate.ai/downloads/releases/latest",
		],
		[
			"extra path component",
			"https://public.mcp.umate.ai/downloads/releases/v0.3.4-beta/update.json",
		],
		[
			"query",
			"https://public.mcp.umate.ai/downloads/releases/v0.3.4-beta?download=1",
		],
		[
			"credentials",
			"https://token@public.mcp.umate.ai/downloads/releases/v0.3.4-beta",
		],
		[
			"fragment",
			"https://public.mcp.umate.ai/downloads/releases/v0.3.4-beta#fragment",
		],
	])("rejects a non-canonical manifest URL source: %s", async (_case, url) => {
		await expect(
			updateCask(
				["--manifest-url", url],
				async () => new Response(Bun.file(fixturePath)),
			),
		).rejects.toThrow("Manifest URL must be canonical");
	});
	test("rejects manifest URL and manifest tag mismatches", async () => {
		await expect(
			updateCask(
				[
					"--manifest-url",
					"https://public.mcp.umate.ai/downloads/releases/v0.3.5-beta",
				],
				async () => new Response(Bun.file(fixturePath)),
			),
		).rejects.toThrow("Manifest URL tag must exactly match the manifest tag");
	});
	test("fails loudly when manifest URL fetching fails", async () => {
		await expect(
			updateCask(
				[
					"--manifest-url",
					"https://public.mcp.umate.ai/downloads/releases/v0.3.4-beta",
				],
				async () => {
					throw new Error("connection refused");
				},
			),
		).rejects.toThrow("Unable to fetch manifest");
	});
	test("rejects manifest redirects without following them", async () => {
		let redirectMode: RequestInit["redirect"];
		await expect(
			updateCask(
				[
					"--manifest-url",
					"https://public.mcp.umate.ai/downloads/releases/v0.3.4-beta",
				],
				async (_url, init) => {
					redirectMode = init?.redirect;
					return new Response(null, {
						status: 302,
						headers: {
							location:
								"https://github.com/loocor/mcpmate/releases/download/v0.3.4-beta/update.json",
						},
					});
				},
			),
		).rejects.toThrow("Manifest redirects are not allowed");
		expect(redirectMode).toBe("manual");
	});
	test("rejects an unsupported schema version with a diagnostic", async () => {
		const path = await temporaryManifest((manifest) => {
			manifest.schemaVersion = 3;
		});
		expect((await runUpdater("--manifest-file", path)).stderr).toContain(
			"Manifest schemaVersion must be 2",
		);
	});
	test("rejects a missing required asset with a diagnostic", async () => {
		const path = await temporaryManifest((manifest) => {
			delete (manifest.assets as Record<string, unknown>)["linux-x64-appimage"];
		});
		expect((await runUpdater("--manifest-file", path)).stderr).toContain(
			"Manifest is missing required asset: linux-x64-appimage",
		);
	});
	test("rejects invalid asset digests with a diagnostic", async () => {
		const path = await temporaryManifest((manifest) => {
			fixtureAsset(manifest, "macos-arm64-dmg").sha256 = "not-a-digest";
		});
		expect((await runUpdater("--manifest-file", path)).stderr).toContain(
			"Manifest sha256 must be 64 lowercase hexadecimal characters: macos-arm64-dmg",
		);
	});
	test("rejects uppercase asset digests outside the Admin v2 contract", async () => {
		const path = await temporaryManifest((manifest) => {
			fixtureAsset(manifest, "macos-arm64-dmg").sha256 = "A".repeat(64);
		});
		expect((await runUpdater("--manifest-file", path)).stderr).toContain(
			"Manifest sha256 must be 64 lowercase hexadecimal characters: macos-arm64-dmg",
		);
	});
	test("rejects tag and version mismatches with a diagnostic", async () => {
		const path = await temporaryManifest((manifest) => {
			manifest.tag = "v0.3.5-beta";
		});
		expect((await runUpdater("--manifest-file", path)).stderr).toContain(
			"Manifest tag must exactly match the full version with a v prefix",
		);
	});
	test("rejects invalid required asset metadata with a diagnostic", async () => {
		const path = await temporaryManifest((manifest) => {
			fixtureAsset(manifest, "linux-arm64-appimage").format = "deb";
		});
		expect((await runUpdater("--manifest-file", path)).stderr).toContain(
			"Manifest asset metadata is invalid: linux-arm64-appimage",
		);
	});
	test.each([
		[
			"GitHub origin",
			"https://github.com/loocor/mcpmate/releases/download/v0.3.4-beta/MCPMate_0.3.4_macos_aarch64.dmg",
		],
		[
			"latest route",
			"https://public.mcp.umate.ai/downloads/homebrew/latest/macos-arm64-dmg",
		],
		[
			"wrong asset key",
			"https://public.mcp.umate.ai/downloads/homebrew/v0.3.4-beta/macos-x64-dmg",
		],
		[
			"query",
			"https://public.mcp.umate.ai/downloads/homebrew/v0.3.4-beta/macos-arm64-dmg?download=1",
		],
		[
			"credentials",
			"https://token@public.mcp.umate.ai/downloads/homebrew/v0.3.4-beta/macos-arm64-dmg",
		],
		[
			"fragment",
			"https://public.mcp.umate.ai/downloads/homebrew/v0.3.4-beta/macos-arm64-dmg#fragment",
		],
		[
			"Ruby injection",
			'https://public.mcp.umate.ai/downloads/homebrew/v0.3.4-beta/macos-arm64-dmg"\n  zap',
		],
	])("rejects a non-canonical homebrewUrl: %s", async (_case, url) => {
		const path = await temporaryManifest((manifest) => {
			fixtureAsset(manifest, "macos-arm64-dmg").homebrewUrl = url;
		});
		expect((await runUpdater("--manifest-file", path)).stderr).toContain(
			"Manifest homebrewUrl must be canonical: macos-arm64-dmg",
		);
	});
	test("rejects unsafe AppImage asset basenames with a diagnostic", async () => {
		const path = await temporaryManifest((manifest) => {
			fixtureAsset(manifest, "linux-arm64-appimage").name =
				"../MCPMate.AppImage";
		});
		expect((await runUpdater("--manifest-file", path)).stderr).toContain(
			"Manifest asset name must be a safe basename: linux-arm64-appimage",
		);
	});
	test.each([
		["beta", "0.3.4-beta", "beta", betaCaskPath],
		["stable", "1.2.3", "stable", stableCaskPath],
	])(
		"is byte-identical when run twice for the %s channel",
		async (_case, version, channel, caskPath) => {
			const path =
				channel === "beta"
					? fixturePath
					: await releaseManifest(version, channel);
			expect((await runUpdater("--manifest-file", path)).exitCode).toBe(0);
			const first = await readFile(caskPath, "utf8");
			expect((await runUpdater("--manifest-file", path)).exitCode).toBe(0);
			expect(await readFile(caskPath, "utf8")).toBe(first);
		},
	);

	test("declares symmetric conflicts because stable and beta install the same artifacts", async () => {
		const stableManifest = await releaseManifest("1.2.3", "stable");
		expect((await runUpdater("--manifest-file", fixturePath)).exitCode).toBe(0);
		expect((await runUpdater("--manifest-file", stableManifest)).exitCode).toBe(
			0,
		);
		expect(await readFile(betaCaskPath, "utf8")).toContain(
			'conflicts_with cask: "mcpmate"',
		);
		expect(await readFile(stableCaskPath, "utf8")).toContain(
			'conflicts_with cask: "mcpmate@beta"',
		);
	});

	test("keeps forbidden fallback and lifecycle artifacts out of every supported channel", async () => {
		const stableManifest = await releaseManifest("1.2.3", "stable");
		expect((await runUpdater("--manifest-file", fixturePath)).exitCode).toBe(0);
		expect((await runUpdater("--manifest-file", stableManifest)).exitCode).toBe(
			0,
		);
		for (const path of [betaCaskPath, stableCaskPath]) {
			const cask = await readFile(path, "utf8");
			expect(cask).not.toContain("/downloads/latest");
			expect(cask).not.toContain("github.com/loocor/mcpmate/releases/download");
			expect(cask.match(/github\.com\/loocor\/mcpmate/g)).toHaveLength(1);
			expect(cask).not.toContain("sha256 :no_check");
			expect(cask).not.toMatch(/^\s*(service|zap)\b/m);
			expect(cask).not.toMatch(/\b(killall|pkill)\b/);
			expect(cask).toContain(
				"does not terminate services or remove ~/.mcpmate",
			);
		}
	});

	test("restores the tracked beta Cask after integration tests", async () => {
		expect(await readFile(betaCaskPath, "utf8")).toBe(originalCask);
	});
});

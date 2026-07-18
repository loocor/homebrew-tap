import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const workflowPath = (name: string) =>
	join(repositoryRoot, ".github", "workflows", name);
const readmePath = join(repositoryRoot, "README.md");
const packagePath = join(repositoryRoot, "package.json");
const tsconfigPath = join(repositoryRoot, "tsconfig.json");
const dollarSign = String.fromCodePoint(36);

async function readWorkflow(name: string): Promise<string> {
	return readFile(workflowPath(name), "utf8");
}

async function parseYaml(name: string): Promise<void> {
	const process = Bun.spawn(
		[
			"ruby",
			"-e",
			"require 'yaml'; YAML.safe_load_file(ARGV.fetch(0), aliases: true)",
			workflowPath(name),
		],
		{
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	expect(await process.exited).toBe(0);
}

function githubExpression(name: string): string {
	return `${dollarSign}{{ ${name} }}`;
}

function shellVariable(name: string): string {
	return `${dollarSign}{${name}}`;
}

describe("tap CI workflow", () => {
	test("parses and validates every tracked MCPMate Cask on pull requests and main pushes", async () => {
		const workflow = await readWorkflow("ci.yml");
		await parseYaml("ci.yml");

		expect(workflow).toMatch(/^on:\n {2}pull_request:/m);
		expect(workflow).toContain("push:\n    branches: [main]");
		expect(workflow).toContain("bun install --frozen-lockfile");
		expect(workflow).toContain("bun test");
		expect(workflow).toContain('brew tap loocor/tap "$GITHUB_WORKSPACE"');
		expect(workflow).toContain("git ls-files 'Casks/mcpmate*.rb'");
		expect(workflow).toContain('brew style --cask "loocor/tap/$cask_token"');
		expect(workflow).toContain(
			'brew audit --cask --strict "loocor/tap/$cask_token"',
		);
		expect(workflow).toContain('brew info --cask "loocor/tap/$cask_token"');
		expect(workflow).not.toContain("mapfile");
	});

	test("runs both supported Linux Homebrew versions and constructs the AppImage artifact", async () => {
		const workflow = await readWorkflow("ci.yml");

		expect(workflow).toContain('homebrew: "5.1.12"');
		expect(workflow).toContain("homebrew: current");
		expect(workflow).toContain(
			'test "$(brew --version | head -n 1)" = "Homebrew 5.1.12"',
		);
		expect(workflow).toContain("git ls-files 'Casks/mcpmate*.rb'");
		expect(workflow).toContain(
			'HOMEBREW_NO_INSTALL_FROM_API=1 brew install --cask "loocor/tap/$cask_token"',
		);
		expect(workflow).toContain('test -L "$HOME/Applications/MCPMate.AppImage"');
		expect(workflow).toContain(
			'test -x "$(readlink -f "$HOME/Applications/MCPMate.AppImage")"',
		);
		expect(workflow).toContain(
			'brew uninstall --cask "loocor/tap/$cask_token"',
		);
		expect(workflow).not.toMatch(/MCPMate\.AppImage" --version/);
	});

	test("validates upstream release discovery on the current macOS runner", async () => {
		const workflow = await readWorkflow("ci.yml");

		expect(workflow).toContain(
			'brew livecheck --cask "loocor/tap/$cask_token"',
		);
		expect(workflow).not.toContain("--newer-only");
		expect(workflow).toContain(
			"matrix.os == 'macos-latest' && matrix.homebrew == 'current'",
		);
		expect(workflow).toContain(
			`HOMEBREW_GITHUB_API_TOKEN: ${githubExpression("github.token")}`,
		);
	});

	test("type-checks Bun scripts with the repository configuration", async () => {
		const workflow = await readWorkflow("ci.yml");
		const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
		const tsconfigExists = await Bun.file(tsconfigPath).exists();

		expect(tsconfigExists).toBe(true);
		if (!tsconfigExists) return;
		const tsconfig = JSON.parse(await readFile(tsconfigPath, "utf8"));

		expect(packageJson.scripts.typecheck).toBe("tsc --noEmit");
		expect(packageJson.devDependencies.typescript).toBeDefined();
		expect(tsconfig.compilerOptions.types).toEqual(["bun"]);
		expect(tsconfig.compilerOptions.strict).toBe(true);
		expect(tsconfig.compilerOptions.noEmit).toBe(true);
		expect(workflow).toContain("bun run typecheck");
	});
});

describe("maintainer documentation", () => {
	test("documents stable and beta targets without advertising an unavailable stable Cask", async () => {
		const readme = await readFile(readmePath, "utf8");
		expect(readme).toContain("| Stable | `mcpmate` | `Casks/mcpmate.rb` |");
		expect(readme).toContain(
			"| Beta | `mcpmate@beta` | `Casks/mcpmate@beta.rb` |",
		);
		expect(readme).toContain(
			"A stable Cask is not published until the first validated stable manifest generates it.",
		);
		expect(readme).not.toContain("brew install --cask loocor/tap/mcpmate\n");
		expect(readme).not.toMatch(
			/supported.*(?:nightly|debug)|(?:nightly|debug).*supported/i,
		);
	});

	test("documents the deployed Admin contract as the release authority", async () => {
		const readme = await readFile(readmePath, "utf8");

		expect(readme).toMatch(
			/The deployed Admin exact-tag manifest and tracked download routes are the\s+release authority/,
		);
		expect(readme).not.toContain("remain an external deployment prerequisite");
	});
});

describe("MCPMate update workflow", () => {
	test("parses and exposes only release dispatch plus controlled manual inputs", async () => {
		const workflow = await readWorkflow("update-mcpmate.yml");
		await parseYaml("update-mcpmate.yml");

		expect(workflow).toMatch(/^name: Update MCPMate Cask$/m);
		expect(workflow).toContain(
			"repository_dispatch:\n    types: [mcpmate_release]",
		);
		expect(workflow).toContain("workflow_dispatch:\n    inputs:");
		expect(workflow).toMatch(
			/tag:\n\s+description: Exact release tag\n\s+required: true/,
		);
		expect(workflow).toMatch(
			/manifest_url:\n\s+description: Exact public HTTPS release manifest URL\n\s+required: true/,
		);
		expect(workflow).not.toContain("schedule:");
	});

	test("derives the selected Cask only from the validated exact-tag manifest", async () => {
		const workflow = await readWorkflow("update-mcpmate.yml");

		expect(workflow).toContain(
			'bun scripts/release-contract.ts "$RELEASE_TAG" "$MANIFEST_URL"',
		);
		expect(workflow).toContain(
			'TARGET_JSON="$(bun scripts/update-mcpmate-cask.ts --manifest-url "$MANIFEST_URL")"',
		);
		expect(workflow).toContain(
			'RELEASE_CHANNEL="$(jq -er \'.releaseChannel\' <<<"$TARGET_JSON")"',
		);
		expect(workflow).toContain(
			'CASK_TOKEN="$(jq -er \'.caskToken\' <<<"$TARGET_JSON")"',
		);
		expect(workflow).toContain(
			'CASK_PATH="$(jq -er \'.caskPath\' <<<"$TARGET_JSON")"',
		);
		expect(workflow).toContain(
			'test "$(jq -er \'.tag\' <<<"$TARGET_JSON")" = "$RELEASE_TAG"',
		);
		expect(workflow).toContain("bun test");
		expect(workflow).toContain('brew tap loocor/tap "$GITHUB_WORKSPACE"');
		expect(workflow).toContain('tap_path="$(brew --repository loocor/tap)"');
		expect(workflow).toContain('cp "$CASK_PATH" "$tap_path/$CASK_PATH"');
		expect(workflow).toContain(
			'brew audit --cask --strict "loocor/tap/$CASK_TOKEN"',
		);
		expect(workflow).toContain('brew info --cask "loocor/tap/$CASK_TOKEN"');
		expect(workflow).not.toContain("/downloads/latest");
		expect(workflow).not.toContain("github.com/loocor/mcpmate");
	});

	test("validates the release before installing Homebrew", async () => {
		const workflow = await readWorkflow("update-mcpmate.yml");
		const validation = workflow.indexOf("- name: Validate release dispatch");
		const homebrewInstall = workflow.indexOf("- name: Install Homebrew");

		expect(validation).toBeGreaterThan(-1);
		expect(homebrewInstall).toBeGreaterThan(-1);
		expect(validation).toBeLessThan(homebrewInstall);
	});

	test("always creates release update branches from main", async () => {
		const workflow = await readWorkflow("update-mcpmate.yml");

		expect(workflow).toMatch(
			/uses: actions\/checkout@v4\n\s+with:\n\s+fetch-depth: 0\n\s+ref: main/,
		);
	});

	test("uses channel-specific publishing metadata and detects a first stable Cask", async () => {
		const workflow = await readWorkflow("update-mcpmate.yml");

		expect(workflow).toMatch(
			/^permissions:\n {2}contents: write\n {2}pull-requests: write$/m,
		);
		expect(workflow).toContain(
			'git status --porcelain --untracked-files=all -- "$CASK_PATH"',
		);
		expect(workflow).toContain('echo "changed=false" >> "$GITHUB_OUTPUT"');
		expect(workflow).toContain("if: steps.cask.outputs.changed == 'true'");
		expect(workflow).toContain(
			`BRANCH="chore/mcpmate-${shellVariable("RELEASE_CHANNEL")}-${shellVariable("VERSION")}"`,
		);
		expect(workflow).toContain(
			`TITLE="chore(mcpmate): update ${shellVariable("RELEASE_CHANNEL")} to ${shellVariable("VERSION")}"`,
		);
		expect(workflow).toContain('gh pr list --head "$BRANCH" --state all');
		expect(workflow).toContain(
			'git ls-remote --exit-code --heads origin "$BRANCH"',
		);
		expect(workflow).toContain('--body-file "$RUNNER_TEMP/mcpmate-pr.md"');
		expect(workflow).toContain("SHA-256 provenance: exact Admin manifest");
		expect(workflow).toContain('git add -- "$CASK_PATH"');
		expect(workflow).not.toContain("git add Casks/mcpmate@beta.rb");
		expect(workflow).not.toMatch(/auto-merge|gh pr merge/i);
	});
});

import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");
const workflowPath = (name: string) => join(repositoryRoot, ".github", "workflows", name);

async function readWorkflow(name: string): Promise<string> {
  return readFile(workflowPath(name), "utf8");
}

async function parseYaml(name: string): Promise<void> {
  const process = Bun.spawn(["ruby", "-e", "require 'yaml'; YAML.safe_load_file(ARGV.fetch(0), aliases: true)", workflowPath(name)], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(await process.exited).toBe(0);
}

describe("tap CI workflow", () => {
  test("parses and validates the cask on pull requests and main pushes", async () => {
    const workflow = await readWorkflow("ci.yml");
    await parseYaml("ci.yml");

    expect(workflow).toMatch(/^on:\n  pull_request:/m);
    expect(workflow).toContain("push:\n    branches: [main]");
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("bun test");
    expect(workflow).toContain('brew tap loocor/tap "$GITHUB_WORKSPACE"');
    expect(workflow).toContain("brew style --cask loocor/tap/mcpmate@beta");
    expect(workflow).toContain("brew audit --cask --strict loocor/tap/mcpmate@beta");
    expect(workflow).toContain("brew info --cask loocor/tap/mcpmate@beta");
  });

  test("runs both supported Linux Homebrew versions and constructs the AppImage artifact", async () => {
    const workflow = await readWorkflow("ci.yml");

    expect(workflow).toContain('homebrew: "5.1.12"');
    expect(workflow).toContain("homebrew: current");
    expect(workflow).toContain('test "$(brew --version | head -n 1)" = "Homebrew 5.1.12"');
    expect(workflow).toContain("HOMEBREW_NO_INSTALL_FROM_API=1 brew install --cask loocor/tap/mcpmate@beta");
    expect(workflow).toContain('test -L "$HOME/Applications/MCPMate.AppImage"');
    expect(workflow).toContain('test -x "$(readlink -f "$HOME/Applications/MCPMate.AppImage")"');
    expect(workflow).toContain("brew uninstall --cask loocor/tap/mcpmate@beta");
    expect(workflow).not.toMatch(/MCPMate\.AppImage" --version/);
  });
});

describe("MCPMate beta update workflow", () => {
  test("parses and exposes only release dispatch plus controlled manual inputs", async () => {
    const workflow = await readWorkflow("update-mcpmate.yml");
    await parseYaml("update-mcpmate.yml");

    expect(workflow).toContain("repository_dispatch:\n    types: [mcpmate_release]");
    expect(workflow).toContain("workflow_dispatch:\n    inputs:");
    expect(workflow).toMatch(/tag:\n\s+description: Exact release tag\n\s+required: true/);
    expect(workflow).toMatch(/manifest_url:\n\s+description: Exact public HTTPS release manifest URL\n\s+required: true/);
    expect(workflow).not.toContain("schedule:");
  });

  test("strictly validates exact tag and HTTPS manifest URL before running the updater", async () => {
    const workflow = await readWorkflow("update-mcpmate.yml");

    expect(workflow).toContain('[[ "$RELEASE_TAG" =~ ^v[0-9]+\\.[0-9]+\\.[0-9]+');
    expect(workflow).toContain('manifestUrl.protocol !== "https:"');
    expect(workflow).toContain('manifestUrl.origin !== "https://public.mcp.umate.ai"');
    expect(workflow).toContain('manifestUrl.pathname !== `/downloads/releases/${tag}`');
    expect(workflow).toContain("bun run update:mcpmate-cask --manifest-url \"$MANIFEST_URL\"");
    expect(workflow).toContain("bun test");
    expect(workflow).toContain('brew tap loocor/tap "$GITHUB_WORKSPACE"');
    expect(workflow).toContain('tap_path="$(brew --repository loocor/tap)"');
    expect(workflow).toContain('cp Casks/mcpmate@beta.rb "$tap_path/Casks/mcpmate@beta.rb"');
    expect(workflow).toContain("brew audit --cask --strict loocor/tap/mcpmate@beta");
    expect(workflow).toContain("brew info --cask loocor/tap/mcpmate@beta");
    expect(workflow).not.toContain("/downloads/latest");
    expect(workflow).not.toContain("github.com/loocor/mcpmate");
  });

  test("uses exact least-privilege publishing and idempotently avoids branches or PRs", async () => {
    const workflow = await readWorkflow("update-mcpmate.yml");

    expect(workflow).toMatch(/^permissions:\n  contents: write\n  pull-requests: write$/m);
    expect(workflow).toContain("git diff --quiet origin/main -- Casks/mcpmate@beta.rb");
    expect(workflow).toContain("echo \"changed=false\" >> \"$GITHUB_OUTPUT\"");
    expect(workflow).toContain("if: steps.cask.outputs.changed == 'true'");
    expect(workflow).toContain('BRANCH="chore/mcpmate-${VERSION}"');
    expect(workflow).toContain('TITLE="chore(mcpmate): update beta to ${VERSION}"');
    expect(workflow).toContain("gh pr list --head \"$BRANCH\" --state open");
    expect(workflow).toContain("--body-file \"$RUNNER_TEMP/mcpmate-pr.md\"");
    expect(workflow).toContain("SHA-256 provenance: exact Admin manifest");
    expect(workflow).not.toMatch(/auto-merge|gh pr merge/i);
  });
});

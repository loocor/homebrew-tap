# Loocor Homebrew Tap

This public tap distributes Loocor desktop applications. MCPMate Beta is
prepared here; future applications, including CodMate, may be co-located here.

The deployed Admin exact-tag manifest and tracked download routes are the
release authority for every referenced asset. Each Cask update must validate
that contract and must not replace versioned Admin URLs with GitHub URLs or
local fallbacks.

## Install MCPMate Beta

MCPMate Beta supports macOS and Linux on arm64 and x64.

```sh
brew install --cask loocor/tap/mcpmate@beta
```

No separate `brew tap` command is required. The fully qualified cask command
adds the tap as needed.

On Linux, MCPMate uses Homebrew's native AppImage support and requires
Homebrew 5.1.12 or later.

## Upgrade

```sh
brew upgrade --cask loocor/tap/mcpmate@beta
```

MCPMate Beta releases may change frequently. Review beta release notes before
upgrading production workflows.

## Uninstall

First exit the MCPMate app and any MCPMate service normally. Then run:

```sh
brew uninstall --cask loocor/tap/mcpmate@beta
```

Uninstall intentionally retains `~/.mcpmate`, including logs, databases, and
user configuration. It does not stop services or remove their state.

## Maintainers

Generate a Cask only from an Admin release manifest. The validated
`releaseChannel` selects the target; callers cannot provide a Cask path.

| Channel | Cask token | Generated path |
| --- | --- | --- |
| Stable | `mcpmate` | `Casks/mcpmate.rb` |
| Beta | `mcpmate@beta` | `Casks/mcpmate@beta.rb` |

A stable Cask is not published until the first validated stable manifest generates it.
Do not create a placeholder stable Cask or advertise stable installation before that
event.

```sh
bun run update:mcpmate-cask --manifest-file path/to/release-manifest-v2.json
```

The updater accepts exactly one source: `--manifest-file <path>` or
`--manifest-url https://public.mcp.umate.ai/downloads/releases/<tag>`. It
accepts only stable and beta release tags, validates the schema version,
release channel, exact URLs, required assets, and SHA-256 digests, then writes
only the selected Cask.

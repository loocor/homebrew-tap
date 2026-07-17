# Loocor Homebrew Tap

This public tap distributes Loocor desktop applications. MCPMate Beta is
prepared here; future applications, including CodMate, may be co-located here.

Before this Cask PR is merged or a release is announced, the Admin public
exact-tag download contract must be deployed for every referenced asset. Until
then, the versioned Admin URLs intentionally remain an external deployment
prerequisite and must not be replaced with GitHub URLs or local fallbacks.

## Install MCPMate Beta

After the Admin download contract is deployed, MCPMate Beta supports macOS and
Linux on arm64 and x64.

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

Generate the cask only from an Admin release manifest:

```sh
bun run update:mcpmate-cask --manifest-file path/to/release-manifest-v2.json
```

The updater accepts exactly one source: `--manifest-file <path>` or
`--manifest-url <https-url>`. It validates the release manifest and writes only
`Casks/mcpmate@beta.rb`.

# frozen_string_literal: true

cask "mcpmate@beta" do
  version "0.3.5-beta"

  name "MCPMate"
  desc "Beta channel for MCP server management and operations"
  homepage "https://mcp.umate.ai/"

  livecheck do
    url "https://github.com/loocor/mcpmate"
    regex(/^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)-beta(?:\.(?:0|[1-9]\d*))?)$/)
    strategy :github_releases do |json, regex|
      json.map do |release|
        next if release["draft"]

        match = release["tag_name"]&.match(regex)
        next unless match

        match[1]
      end
    end
  end

  conflicts_with cask: "mcpmate"

  on_macos do
    on_arm do
      sha256 "ba783d02a97a3a07c85426c96e0a4ff0cbca59c9cd30c2b82f57159a2a2057ec"
      url "https://public.mcp.umate.ai/downloads/homebrew/v#{version}/macos-arm64-dmg"
    end
    on_intel do
      sha256 "a21b5a6693839ccbe8fa5a84cb329342d40c8bacfb42f8bed07d2c13fdeb84b1"
      url "https://public.mcp.umate.ai/downloads/homebrew/v#{version}/macos-x64-dmg"
    end

    app "MCPMate.app"
  end

  on_linux do
    on_arm do
      sha256 "0292851a97b72c12e70717644dbc3869f811f46363c880d6b4064dea732d313e"
      url "https://public.mcp.umate.ai/downloads/homebrew/v#{version}/linux-arm64-appimage"
      app_image "MCPMate_0.3.5_linux_arm64.AppImage", target: "MCPMate.AppImage"
    end
    on_intel do
      sha256 "80fb514b905fc9c2b7882006a2720fe88acd2887bbdc53702d54f060414721c7"
      url "https://public.mcp.umate.ai/downloads/homebrew/v#{version}/linux-x64-appimage"
      app_image "MCPMate_0.3.5_linux_x64.AppImage", target: "MCPMate.AppImage"
    end
  end

  caveats <<~EOS
    MCPMate supports macOS and Linux on arm64 and x64.
    Linux AppImage installation requires Homebrew 5.1.12 or later.
    Exit the MCPMate app and any MCPMate service normally before uninstalling.
    Uninstall does not terminate services or remove ~/.mcpmate, including logs,
    databases, and user configuration.
  EOS
end

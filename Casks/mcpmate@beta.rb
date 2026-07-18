# frozen_string_literal: true

cask "mcpmate@beta" do
  version "0.3.4-beta"

  name "MCPMate"
  desc "Beta channel for MCP server management and operations"
  homepage "https://mcp.umate.ai/"

  conflicts_with cask: "mcpmate"

  on_macos do
    on_arm do
      sha256 "8f8f1c283e53d955b0da33d74afdde9bc30e92f6fc3114a18d2ebf6d75d29ce1"
      url "https://public.mcp.umate.ai/downloads/homebrew/v#{version}/macos-arm64-dmg"
    end
    on_intel do
      sha256 "2c32b23fccd61a9c67769e837d763dee8efddb0be45c95290fdeec2c9e4eb3be"
      url "https://public.mcp.umate.ai/downloads/homebrew/v#{version}/macos-x64-dmg"
    end

    app "MCPMate.app"
  end

  on_linux do
    on_arm do
      sha256 "25ec91d39a54d7bb5a9c63dda4f72335e9e6283a2693b0bc0e8bb103b0b8bff2"
      url "https://public.mcp.umate.ai/downloads/homebrew/v#{version}/linux-arm64-appimage"
      app_image "MCPMate_0.3.4_linux_arm64.AppImage", target: "MCPMate.AppImage"
    end
    on_intel do
      sha256 "0295911991747e766cd3441f26dc9cd89c58fcf45018fd4ca1242c8277952f13"
      url "https://public.mcp.umate.ai/downloads/homebrew/v#{version}/linux-x64-appimage"
      app_image "MCPMate_0.3.4_linux_x64.AppImage", target: "MCPMate.AppImage"
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

import { describe, expect, test } from "bun:test";
import { validateReleaseDispatch } from "../scripts/release-contract";

describe("release dispatch contract", () => {
  test.each([
    ["v1.2.3", "stable"],
    ["v1.2.3-beta", "beta"],
    ["v1.2.3-beta.7", "beta"],
  ] as const)("accepts canonical %s dispatch", (tag, releaseChannel) => {
    expect(validateReleaseDispatch(tag, `https://public.mcp.umate.ai/downloads/releases/${tag}`)).toEqual({
      tag,
      releaseChannel,
      manifestUrl: `https://public.mcp.umate.ai/downloads/releases/${tag}`,
    });
  });

  test.each([
    ["explicit default port", "https://public.mcp.umate.ai:443/downloads/releases/v1.2.3"],
    ["dot segment", "https://public.mcp.umate.ai/downloads/releases/ignored/../v1.2.3"],
    ["leading whitespace", " https://public.mcp.umate.ai/downloads/releases/v1.2.3"],
    ["trailing whitespace", "https://public.mcp.umate.ai/downloads/releases/v1.2.3 "],
  ])("rejects a non-canonical manifest URL: %s", (_case, manifestUrl) => {
    expect(() => validateReleaseDispatch("v1.2.3", manifestUrl)).toThrow(
      "manifest_url must be the exact Admin release manifest URL for the tag",
    );
  });
});

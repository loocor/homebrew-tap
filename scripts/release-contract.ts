export type ReleaseChannel = "stable" | "beta";

export type ReleaseDispatch = {
  tag: string;
  releaseChannel: ReleaseChannel;
  manifestUrl: string;
};

const versionCore = "(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)";
const releaseTag = new RegExp(`^v${versionCore}(?<beta>-beta(?:\\.(?:0|[1-9][0-9]*))?)?$`);

export const homebrewOrigin = "https://public.mcp.umate.ai";
export const manifestPathPrefix = "/downloads/releases/";

export function parseReleaseTag(tag: string): ReleaseChannel | null {
  const match = releaseTag.exec(tag);
  if (!match) return null;
  return match.groups?.beta ? "beta" : "stable";
}

export function releaseManifestUrl(tag: string): string {
  return `${homebrewOrigin}${manifestPathPrefix}${tag}`;
}

export function validateReleaseDispatch(tag: string, manifestUrl: string): ReleaseDispatch {
  const releaseChannel = parseReleaseTag(tag);
  if (!releaseChannel) {
    throw new Error("tag must be an exact stable or beta MCPMate release tag");
  }
  if (manifestUrl !== releaseManifestUrl(tag)) {
    throw new Error("manifest_url must be the exact Admin release manifest URL for the tag");
  }
  return { tag, releaseChannel, manifestUrl };
}

if (import.meta.main) {
  try {
    const [tag, manifestUrl, ...extra] = process.argv.slice(2);
    if (!tag || !manifestUrl || extra.length > 0) {
      throw new Error("tag and manifest_url are required");
    }
    validateReleaseDispatch(tag, manifestUrl);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

/**
 * Sanitize a note path for use as a zip entry name: forward slashes, no `..`,
 * and a `.md` suffix (`.markdown` normalized to `.md`).
 */
export function sanitizeZipEntryPath(notePath: string): string {
  const withForwardSlashes = notePath.replace(/\\/g, "/");
  const trimmed = withForwardSlashes.replace(/^\/+/, "");
  const segments = trimmed.split("/").filter((s) => s.length > 0);

  if (segments.length === 0) {
    throw new Error("Zip entry path cannot be empty");
  }

  for (const segment of segments) {
    if (segment === "..") {
      throw new Error(
        `Zip entry path must not contain ".." segments (got ${JSON.stringify(notePath)})`,
      );
    }
  }

  const lastIndex = segments.length - 1;
  const last = segments[lastIndex]!;
  const lower = last.toLowerCase();

  let nextLast: string;
  if (lower.endsWith(".markdown")) {
    nextLast = `${last.slice(0, -".markdown".length)}.md`;
  } else if (lower.endsWith(".md")) {
    nextLast = last;
  } else {
    nextLast = `${last}.md`;
  }

  segments[lastIndex] = nextLast;
  return segments.join("/");
}

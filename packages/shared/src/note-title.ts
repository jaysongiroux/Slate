export function deriveDocumentTitle(markdown: string): string {
  const heading = markdown
    .split("\n")
    .find((line) => line.startsWith("# "))
    ?.replace(/^#\s+/, "")
    .trim();

  return heading || "Untitled";
}

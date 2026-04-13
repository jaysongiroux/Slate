import { deriveDocumentTitle } from "@slate/shared";

/**
 * Title to use when syncing editor markdown to note metadata. `deriveDocumentTitle` returns
 * "Untitled" when there is no `# ` heading; daily notes and other files already have a real
 * stored title that must not be overwritten until the user adds a top-level heading.
 */
export function documentTitleFromMarkdown(
  markdown: string,
  options?: { existingTitle?: string | null },
): string {
  const derived = deriveDocumentTitle(markdown);
  const prev = (options?.existingTitle ?? "").trim();
  if (derived === "Untitled" && prev !== "" && prev.toLowerCase() !== "untitled") {
    return prev;
  }
  return derived;
}

import { describe, expect, it } from "vitest";
import { deriveDocumentTitle } from "./note-title";

describe("deriveDocumentTitle", () => {
  it("returns the first H1 as the document title", () => {
    expect(deriveDocumentTitle("# Show\n\nBody")).toBe("Show");
  });

  it("ignores lower-level headings before the first H1", () => {
    expect(deriveDocumentTitle("## Section\n\n# Show\n\nBody")).toBe("Show");
  });

  it("falls back to Untitled when no H1 exists", () => {
    expect(deriveDocumentTitle("Plain paragraph\n\n## Section")).toBe("Untitled");
  });
});

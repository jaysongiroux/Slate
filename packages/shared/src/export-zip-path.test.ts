import { describe, expect, it } from "vitest";
import { sanitizeZipEntryPath } from "./export-zip-path";

describe("sanitizeZipEntryPath", () => {
  it('maps "foo/bar" to "foo/bar.md"', () => {
    expect(sanitizeZipEntryPath("foo/bar")).toBe("foo/bar.md");
  });

  it("strips leading slashes", () => {
    expect(sanitizeZipEntryPath("/foo/bar")).toBe("foo/bar.md");
    expect(sanitizeZipEntryPath("///a/b")).toBe("a/b.md");
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(sanitizeZipEntryPath("foo\\bar\\baz")).toBe("foo/bar/baz.md");
  });

  it("leaves .md suffix unchanged", () => {
    expect(sanitizeZipEntryPath("foo/bar.md")).toBe("foo/bar.md");
    expect(sanitizeZipEntryPath("x/note.MD")).toBe("x/note.MD");
  });

  it("normalizes .markdown to .md", () => {
    expect(sanitizeZipEntryPath("foo/bar.markdown")).toBe("foo/bar.md");
    expect(sanitizeZipEntryPath("dir/Note.MarkDown")).toBe("dir/Note.md");
  });

  it('throws when a segment is ".."', () => {
    expect(() => sanitizeZipEntryPath("../x")).toThrow(/must not contain/);
    expect(() => sanitizeZipEntryPath("a/../b")).toThrow(/must not contain/);
    expect(() => sanitizeZipEntryPath("..")).toThrow(/must not contain/);
  });

  it("throws on empty path after normalization", () => {
    expect(() => sanitizeZipEntryPath("")).toThrow(/cannot be empty/);
    expect(() => sanitizeZipEntryPath("///")).toThrow(/cannot be empty/);
  });
});

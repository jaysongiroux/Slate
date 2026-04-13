import { describe, expect, it, vi } from "vitest";
import { inlineAttachmentImagesInMarkdown, looksLikeAttachmentSrc } from "./export-inline-images";

describe("looksLikeAttachmentSrc", () => {
  it("detects relative attachment API paths", () => {
    expect(looksLikeAttachmentSrc("/api/attachments/a/content")).toBe(true);
  });

  it("detects slate-attachment scheme", () => {
    expect(looksLikeAttachmentSrc("slate-attachment:foo")).toBe(true);
  });

  it("detects https attachment URLs by pathname", () => {
    expect(looksLikeAttachmentSrc("https://example.com/api/attachments/x/y")).toBe(true);
  });

  it("does not treat arbitrary https URLs as attachments", () => {
    expect(looksLikeAttachmentSrc("https://cdn.example.com/cat.png")).toBe(false);
  });
});

describe("inlineAttachmentImagesInMarkdown", () => {
  it("inlines /api/attachments/ images as base64 data URLs", async () => {
    const resolveUrl = vi.fn(async (s: string) => s);
    const fetchBinary = vi.fn(async () => ({
      bytes: new Uint8Array([137, 80, 78, 71]),
      mime: "image/png",
    }));
    const out = await inlineAttachmentImagesInMarkdown(
      "![x](/api/attachments/a/content)",
      resolveUrl,
      fetchBinary,
    );
    expect(out).toContain("![x](data:image/png;base64,");
    expect(resolveUrl).toHaveBeenCalledWith("/api/attachments/a/content");
    expect(fetchBinary).toHaveBeenCalledWith("/api/attachments/a/content");
  });

  it("leaves external https images unchanged", async () => {
    const resolveUrl = vi.fn();
    const fetchBinary = vi.fn();
    const md = "![z](https://example.com/a.png)";
    const out = await inlineAttachmentImagesInMarkdown(md, resolveUrl, fetchBinary);
    expect(out).toBe(md);
    expect(resolveUrl).not.toHaveBeenCalled();
    expect(fetchBinary).not.toHaveBeenCalled();
  });

  it("inlines slate-attachment after resolve points at attachment path", async () => {
    const resolveUrl = vi.fn(async () => "https://localhost/api/attachments/b/c");
    const fetchBinary = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      mime: "image/png",
    }));
    const out = await inlineAttachmentImagesInMarkdown(
      "![a](slate-attachment:foo)",
      resolveUrl,
      fetchBinary,
    );
    expect(out).toMatch(/!\[a\]\(data:image\/png;base64,/);
    expect(resolveUrl).toHaveBeenCalledWith("slate-attachment:foo");
    expect(fetchBinary).toHaveBeenCalledWith("https://localhost/api/attachments/b/c");
  });

  it("inlines https attachment URLs", async () => {
    const resolveUrl = vi.fn(async (s: string) => s);
    const fetchBinary = vi.fn(async () => ({
      bytes: new Uint8Array([9]),
      mime: "image/png",
    }));
    const url = "https://app.test/api/attachments/id/blob";
    const out = await inlineAttachmentImagesInMarkdown(`![q](${url})`, resolveUrl, fetchBinary);
    expect(out).toContain("data:image/png;base64,");
    expect(fetchBinary).toHaveBeenCalledWith(url);
  });

  it("propagates fetchBinary errors", async () => {
    const resolveUrl = async (s: string) => s;
    const fetchBinary = async () => {
      throw new Error("fetch failed");
    };
    await expect(
      inlineAttachmentImagesInMarkdown("![x](/api/attachments/x)", resolveUrl, fetchBinary),
    ).rejects.toThrow("fetch failed");
  });
});

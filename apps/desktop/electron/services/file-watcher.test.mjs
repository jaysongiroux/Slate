import { describe, it, expect, vi, beforeEach } from "vitest";
import { FileWatcher } from "./file-watcher.mjs";
import { createHash } from "crypto";

function md5(content) {
  return createHash("md5").update(content).digest("hex");
}

describe("FileWatcher", () => {
  let watcher;
  let mockMetadataStore;
  let mockOnExternalChange;

  beforeEach(() => {
    mockMetadataStore = {
      getSetting: vi.fn().mockReturnValue(false),
    };
    mockOnExternalChange = vi.fn();
    watcher = new FileWatcher({
      metadataStore: mockMetadataStore,
      onExternalChange: mockOnExternalChange,
    });
  });

  describe("self-write tracking", () => {
    it("ignores file changes that match a self-write hash", () => {
      const content = "# Hello\n\nWorld";
      const filePath = "/workspace/notes/test.md";

      watcher.recordSelfWrite(filePath, content);
      const isExternal = watcher.isExternalChange(filePath, content);

      expect(isExternal).toBe(false);
    });

    it("detects external changes when hash differs from self-write", () => {
      const original = "# Hello\n\nWorld";
      const external = "# Hello\n\nModified externally";
      const filePath = "/workspace/notes/test.md";

      watcher.recordSelfWrite(filePath, original);
      const isExternal = watcher.isExternalChange(filePath, external);

      expect(isExternal).toBe(true);
    });

    it("treats unknown files as external changes", () => {
      const isExternal = watcher.isExternalChange("/unknown/file.md", "content");
      expect(isExternal).toBe(true);
    });
  });

  describe("external change handling", () => {
    it("calls onExternalChange when auto-reconcile is off", () => {
      mockMetadataStore.getSetting.mockReturnValue(false);
      const filePath = "/workspace/notes/test.md";
      const content = "# Modified";

      watcher.handleFileChange(filePath, content);

      expect(mockOnExternalChange).toHaveBeenCalledWith({
        filePath,
        content,
        autoReconcile: false,
      });
    });

    it("calls onExternalChange with autoReconcile=true when setting is on", () => {
      mockMetadataStore.getSetting.mockReturnValue(true);
      const filePath = "/workspace/notes/test.md";
      const content = "# Modified";

      watcher.handleFileChange(filePath, content);

      expect(mockOnExternalChange).toHaveBeenCalledWith({
        filePath,
        content,
        autoReconcile: true,
      });
    });
  });
});

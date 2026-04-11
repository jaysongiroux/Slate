import { useCallback, useState } from "react";
import { zip } from "fflate";
import {
  inlineAttachmentImagesInMarkdown,
  noteContentToMarkdown,
  sanitizeZipEntryPath,
} from "@slate/shared";
import type { SlateDatabase } from "../db/database";
import { resolveAttachmentUrl } from "../lib/api/attachments-api";
import { desktopApi } from "../lib/api/ipc-core";

export type MarkdownZipExportResult =
  | { ok: true; path: string }
  | { canceled: true };

export type MarkdownZipExportParams = {
  db: SlateDatabase;
  noteIds: string[];
};

function wrapExportError(noteId: string, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  return new Error(`Note ${noteId}: ${message}`, { cause: err });
}

export async function exportNotesToZip(
  params: MarkdownZipExportParams,
): Promise<MarkdownZipExportResult> {
  const files: Record<string, Uint8Array> = {};

  for (const noteId of params.noteIds) {
    let doc;
    try {
      doc = await params.db.notes.findOne({ selector: { id: noteId } }).exec();
    } catch (e) {
      throw wrapExportError(noteId, e);
    }

    if (!doc || doc.isDeleted) continue;

    try {
      let md = noteContentToMarkdown(doc.content as Record<string, unknown>);
      md = await inlineAttachmentImagesInMarkdown(
        md,
        resolveAttachmentUrl,
        async (url) => {
          const r = await fetch(url);
          if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status}`);
          const buf = new Uint8Array(await r.arrayBuffer());
          const mime =
            r.headers.get("content-type")?.split(";")[0]?.trim() ||
            "application/octet-stream";
          return { bytes: buf, mime };
        },
      );
      const key = sanitizeZipEntryPath(doc.path);
      files[key] = new TextEncoder().encode(md);
    } catch (e) {
      throw wrapExportError(noteId, e);
    }
  }

  let zipped: Uint8Array;
  try {
    zipped = await new Promise<Uint8Array>((res, rej) => {
      zip(files, { level: 6 }, (err, u8) => (err ? rej(err) : res(u8)));
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(`ZIP build failed: ${message}`, { cause: e });
  }

  return desktopApi().saveZipExport({
    defaultFilename: `slate-export-${new Date().toISOString().slice(0, 10)}.zip`,
    data: zipped,
  });
}

export function useMarkdownExport() {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportNotesToZipFromHook = useCallback(async (params: MarkdownZipExportParams) => {
    setError(null);
    setExporting(true);
    try {
      return await exportNotesToZip(params);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      throw e;
    } finally {
      setExporting(false);
    }
  }, []);

  return { exportNotesToZip: exportNotesToZipFromHook, exporting, error };
}

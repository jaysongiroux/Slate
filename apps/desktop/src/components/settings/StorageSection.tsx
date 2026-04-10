import { useState } from "react";
import { Button } from "../ui/button";

export interface StorageSectionProps {
  noteCount: number;
  templateCount: number;
  folderCount: number;
  onImportFiles?: () => Promise<{ total: number; imported: number; errors: number } | null>;
  onImportFolder?: () => Promise<{ total: number; imported: number; errors: number } | null>;
}

export function StorageSection({
  noteCount,
  templateCount,
  folderCount,
  onImportFiles,
  onImportFolder,
}: StorageSectionProps) {
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState<"files" | "folder" | null>(null);

  const handleImport = async (
    importFn: () => Promise<{ total: number; imported: number; errors: number } | null>,
    type: "files" | "folder",
  ) => {
    setIsImporting(type);
    setImportStatus(null);
    try {
      const result = await importFn();
      if (result === null) {
        // User closed the dialog — stay silent
      } else if (result.errors > 0) {
        setImportStatus(
          `Imported ${result.imported} of ${result.total} notes (${result.errors} errors).`,
        );
      } else {
        setImportStatus(
          `Imported ${result.imported} note${result.imported !== 1 ? "s" : ""} successfully.`,
        );
      }
    } catch (err) {
      setImportStatus(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsImporting(null);
    }
  };

  return (
    <>
      <div className="grid gap-3 rounded-[14px] border border-white/[0.06] bg-white/[0.04] p-3.5">
        <div className="text-[0.96rem] font-semibold text-foreground">Local library</div>
        <div className="grid gap-1 text-[0.82rem] text-faint">
          <div>{noteCount} notes in the local library</div>
          <div>{templateCount} templates available</div>
          <div>{folderCount} folders organized locally</div>
        </div>
      </div>

      {onImportFiles || onImportFolder ? (
        <div className="grid gap-2 pt-1">
          <div className="text-[0.84rem] text-muted">Import Markdown</div>
          <p className="m-0 text-[0.78rem] leading-snug text-faint">
            Import <code className="font-mono">.md</code> files or a folder of markdown files into
            the local database.
          </p>
          <div className="flex gap-2">
            {onImportFiles ? (
              <Button
                variant="dialog-secondary"
                className="text-sm"
                disabled={!!isImporting}
                onClick={() => handleImport(onImportFiles, "files")}
              >
                {isImporting === "files" ? "Importing…" : "Import Files"}
              </Button>
            ) : null}
            {onImportFolder ? (
              <Button
                variant="dialog-secondary"
                className="text-sm"
                disabled={!!isImporting}
                onClick={() => handleImport(onImportFolder, "folder")}
              >
                {isImporting === "folder" ? "Importing…" : "Import Folder"}
              </Button>
            ) : null}
          </div>
          {importStatus ? (
            <p className="m-0 text-[0.78rem] leading-snug text-faint">{importStatus}</p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

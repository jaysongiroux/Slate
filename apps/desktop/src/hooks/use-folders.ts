import { useState, useEffect } from "react";
import type { FolderDocType } from "../db/schemas/folder.schema";
import type { SlateDatabase } from "../db/database";

export function useFolders(db: SlateDatabase | null) {
  const [folders, setFolders] = useState<FolderDocType[]>([]);

  useEffect(() => {
    if (!db) return;

    const sub = db.folders.find({ sort: [{ path: "asc" }] }).$.subscribe((docs) => {
      setFolders(docs.map((d) => d.toJSON()));
    });

    return () => sub.unsubscribe();
  }, [db]);

  return folders;
}

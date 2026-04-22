import { useCallback, useEffect, useState } from "react";
import {
  createDiagram,
  deleteDiagram,
  listDiagrams,
  updateDiagram,
  type DiagramSummary,
} from "../lib/api/diagrams-api";

export function useDiagrams() {
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listDiagrams();
      setDiagrams(list);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const create = useCallback(
    async (title?: string) => {
      const created = await createDiagram(title);
      await refresh();
      return created;
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteDiagram(id);
      await refresh();
    },
    [refresh],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      await updateDiagram({ id, title });
      await refresh();
    },
    [refresh],
  );

  return { diagrams, loading, refresh, create, remove, rename };
}

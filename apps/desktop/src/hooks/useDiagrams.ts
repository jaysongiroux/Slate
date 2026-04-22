import { useCallback, useEffect, useState } from "react";
import {
  createDiagram,
  deleteDiagram,
  listDiagrams,
  updateDiagram,
  type DiagramSummary,
} from "../lib/api/diagrams-api";
import { useAppStore } from "../stores/app-store";

export function useDiagrams(enabled: boolean = true) {
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([]);
  const [loading, setLoading] = useState(enabled);
  const refreshSignal = useAppStore((s) => s.diagramRefreshSignal);
  const bumpRefresh = useAppStore((s) => s.bumpDiagramRefreshSignal);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const list = await listDiagrams();
      setDiagrams(list);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setDiagrams([]);
      setLoading(false);
      return;
    }
    void refresh();
  }, [enabled, refresh, refreshSignal]);

  const create = useCallback(
    async (title?: string) => {
      const created = await createDiagram(title);
      bumpRefresh();
      return created;
    },
    [bumpRefresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteDiagram(id);
      bumpRefresh();
    },
    [bumpRefresh],
  );

  const rename = useCallback(
    async (id: string, title: string) => {
      await updateDiagram({ id, title });
      bumpRefresh();
    },
    [bumpRefresh],
  );

  return { diagrams, loading, refresh, create, remove, rename };
}

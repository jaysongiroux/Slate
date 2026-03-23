import { createContext, useContext, useEffect, useRef, useState } from "react";
import * as Y from "yjs";

interface YDocContextValue {
  yDoc: Y.Doc | null;
  yFragment: Y.XmlFragment | null;
  isReady: boolean;
}

const YDocContext = createContext<YDocContextValue>({ yDoc: null, yFragment: null, isReady: false });

export function useYDoc() { return useContext(YDocContext); }

const FRAGMENT_NAME = "prosemirror";

export function YDocProvider({ noteId, children }: { noteId: string | null; children: React.ReactNode }) {
  const [state, setState] = useState<YDocContextValue>({ yDoc: null, yFragment: null, isReady: false });
  const docRef = useRef<Y.Doc | null>(null);
  const noteIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!noteId) {
      setState({ yDoc: null, yFragment: null, isReady: false });
      return;
    }

    noteIdRef.current = noteId;
    let destroyed = false;

    async function init() {
      if (docRef.current) { docRef.current.destroy(); docRef.current = null; }

      const doc = new Y.Doc();
      docRef.current = doc;

      const api = (window as any).slateDesktop;
      if (api?.getCrdtState) {
        const existingState = await api.getCrdtState(noteId);
        if (destroyed) { doc.destroy(); return; }
        if (existingState) {
          Y.applyUpdate(doc, new Uint8Array(existingState));
        }
      }

      // Send local Y.Doc updates to main process for persistence + sync
      doc.on("update", (update: Uint8Array, origin: any) => {
        if (origin === "remote") return;
        const api = (window as any).slateDesktop;
        api?.applyCrdtUpdate?.(noteId, Array.from(update));
      });

      // Listen for remote CRDT updates from main process (e.g., from server sync)
      if (api?.onRemoteCrdtUpdate) {
        api.onRemoteCrdtUpdate((_event: any, payload: { noteId: string; update: number[] }) => {
          if (payload.noteId === noteId && !destroyed && docRef.current) {
            Y.applyUpdate(docRef.current, new Uint8Array(payload.update), "remote");
          }
        });
      }

      if (!destroyed) {
        setState({ yDoc: doc, yFragment: doc.getXmlFragment(FRAGMENT_NAME), isReady: true });
      }
    }

    void init();
    return () => {
      destroyed = true;
      // Remove remote update listener
      const api = (window as any).slateDesktop;
      api?.offRemoteCrdtUpdate?.();
      if (docRef.current) { docRef.current.destroy(); docRef.current = null; }
      setState({ yDoc: null, yFragment: null, isReady: false });
    };
  }, [noteId]);

  return <YDocContext.Provider value={state}>{children}</YDocContext.Provider>;
}

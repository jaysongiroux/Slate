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
  const initCounterRef = useRef(0);

  useEffect(() => {
    if (!noteId) {
      setState({ yDoc: null, yFragment: null, isReady: false });
      return;
    }

    noteIdRef.current = noteId;
    const initId = ++initCounterRef.current;
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
          let bytes: Uint8Array;
          if (existingState instanceof Uint8Array) {
            bytes = existingState;
          } else if (existingState instanceof ArrayBuffer) {
            bytes = new Uint8Array(existingState);
          } else {
            bytes = new Uint8Array(existingState as ArrayLike<number>);
          }
          Y.applyUpdate(doc, bytes);
        }
      }

      // Send local Y.Doc updates to main process for persistence + sync
      doc.on("update", (update: Uint8Array, origin: any) => {
        if (origin === "remote") return;
        const api = (window as any).slateDesktop;
        api?.applyCrdtUpdate?.(noteId, new Uint8Array(update));
      });

      // Listen for remote CRDT updates (incremental, same-origin updates)
      if (api?.onRemoteCrdtUpdate) {
        api.onRemoteCrdtUpdate((_event: any, payload: { noteId: string; update: Uint8Array | number[] }) => {
          if (payload.noteId === noteId && !destroyed && docRef.current) {
            const bytes =
              payload.update instanceof Uint8Array
                ? payload.update
                : new Uint8Array(payload.update);
            Y.applyUpdate(docRef.current, bytes, "remote");
          }
        });
      }

      // Listen for full state resets (e.g., external file change or server pull).
      // When the backend re-bootstraps a Y.Doc from markdown, the new state has
      // different client IDs. Merging it into the existing Y.Doc would duplicate
      // content. Instead, destroy and re-initialize from the fresh persisted state.
      if (api?.onCrdtStateReset) {
        api.onCrdtStateReset((_event: any, payload: { noteId: string }) => {
          if (payload.noteId === noteId && !destroyed && initId === initCounterRef.current) {
            void init();
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
      const api = (window as any).slateDesktop;
      api?.offRemoteCrdtUpdate?.();
      api?.offCrdtStateReset?.();
      if (docRef.current) { docRef.current.destroy(); docRef.current = null; }
      setState({ yDoc: null, yFragment: null, isReady: false });
    };
  }, [noteId]);

  return <YDocContext.Provider value={state}>{children}</YDocContext.Provider>;
}

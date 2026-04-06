import { createContext, useContext, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";

interface SyncContextValue {
  ydoc: Y.Doc | null;
  provider: HocuspocusProvider | null;
  isReady: boolean;
  isSynced: boolean;
  isConnected: boolean;
}

const SyncContext = createContext<SyncContextValue>({
  ydoc: null,
  provider: null,
  isReady: false,
  isSynced: false,
  isConnected: false,
});

export function useSyncContext() {
  return useContext(SyncContext);
}

export function SyncProvider({
  noteId,
  backendUrl,
  getToken,
  children,
}: {
  noteId: string | null;
  backendUrl: string | null;
  getToken: () => Promise<string>;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<SyncContextValue>({
    ydoc: null,
    provider: null,
    isReady: false,
    isSynced: false,
    isConnected: false,
  });

  const providerRef = useRef<HocuspocusProvider | null>(null);
  const indexeddbRef = useRef<IndexeddbPersistence | null>(null);

  useEffect(() => {
    if (!noteId) {
      setState({
        ydoc: null,
        provider: null,
        isReady: false,
        isSynced: false,
        isConnected: false,
      });
      return;
    }

    const ydoc = new Y.Doc();
    let destroyed = false;

    const log = (msg: string, ...args: any[]) =>
      console.log(`[SyncProvider ${noteId}] ${msg}`, ...args);

    // Local offline persistence — loads cached state instantly
    const indexeddb = new IndexeddbPersistence(`slate-${noteId}`, ydoc);
    indexeddbRef.current = indexeddb;

    // Once IndexedDB has loaded, the doc is ready for editing (even offline)
    indexeddb.on("synced", () => {
      if (destroyed) return;
      log("IndexedDB synced, doc ready");
      setState((prev) => ({ ...prev, ydoc, isReady: true }));
    });

    let provider: HocuspocusProvider | null = null;

    // Connect to Hocuspocus if we have a backend URL
    if (backendUrl) {
      const wsUrl = backendUrl.replace(/^http/, "ws") + "/collaboration";
      log(`connecting to ${wsUrl}`);

      provider = new HocuspocusProvider({
        url: wsUrl,
        name: noteId,
        document: ydoc,
        token: getToken,
        onSynced() {
          if (!destroyed) {
            log("synced with server");
            setState((prev) => ({ ...prev, isSynced: true }));
          }
        },
        onConnect() {
          if (!destroyed) {
            log("connected to server");
            setState((prev) => ({ ...prev, isConnected: true }));
          }
        },
        onDisconnect() {
          if (!destroyed) {
            log("disconnected from server");
            setState((prev) => ({ ...prev, isConnected: false, isSynced: false }));
          }
        },
        onAuthenticationFailed(data) {
          log("auth failed", data);
          if (!destroyed) {
            setState((prev) => ({ ...prev, isConnected: false }));
          }
        },
      });

      providerRef.current = provider;
    } else {
      log("no backendUrl, offline only");
    }

    // Set initial state — isReady will flip to true once IndexedDB syncs
    setState({
      ydoc,
      provider,
      isReady: false,
      isSynced: false,
      isConnected: false,
    });

    // Store the note's path in the Y.Doc meta map so the server knows the file path
    const api = (window as any).slateDesktop;
    if (api?.getNotePath) {
      api.getNotePath(noteId).then((path: string) => {
        if (!destroyed && path) {
          ydoc.getMap("meta").set("path", path);
        }
      });
    }

    return () => {
      destroyed = true;
      provider?.destroy();
      providerRef.current = null;
      indexeddb.destroy();
      indexeddbRef.current = null;
      ydoc.destroy();
      setState({
        ydoc: null,
        provider: null,
        isReady: false,
        isSynced: false,
        isConnected: false,
      });
    };
  }, [noteId, backendUrl]);

  return <SyncContext.Provider value={state}>{children}</SyncContext.Provider>;
}

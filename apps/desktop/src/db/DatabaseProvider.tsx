import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getDatabase, destroyDatabase, type SlateDatabase } from "./database";
import { setupReplication, type ReplicationHandle } from "./replication";
import { resolveBackendBaseUrl } from "../lib/backend-sync.mjs";

interface DatabaseContextValue {
  db: SlateDatabase | null;
  resetFromServer: () => Promise<void>;
  cancelReplication: () => void;
  restartReplication: () => Promise<void>;
}

const DatabaseContext = createContext<DatabaseContextValue>({
  db: null,
  resetFromServer: async () => {},
  cancelReplication: () => {},
  restartReplication: async () => {},
});

export function useDatabase(): SlateDatabase | null {
  return useContext(DatabaseContext).db;
}

export function useDatabaseReset(): () => Promise<void> {
  return useContext(DatabaseContext).resetFromServer;
}

export function useDatabaseReplicationControl() {
  const ctx = useContext(DatabaseContext);
  return {
    cancelReplication: ctx.cancelReplication,
    restartReplication: ctx.restartReplication,
  };
}

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<SlateDatabase | null>(null);
  const handleRef = useRef<ReplicationHandle | null>(null);

  async function startReplication(database: SlateDatabase): Promise<ReplicationHandle | null> {
    const api = (window as any).slateDesktop;
    const backendEndpoint = await api?.getConfig("backendEndpoint");
    const backendUrl = resolveBackendBaseUrl(backendEndpoint);
    const token = await api?.getConfig("accessToken");
    const authenticatedUserId = await api?.getConfig("authenticatedUserId");

    if (backendUrl && token) {
      const userScope =
        typeof authenticatedUserId === "string" && authenticatedUserId
          ? authenticatedUserId
          : "unknown-user";
      const replicationScope = `${encodeURIComponent(backendUrl)}::${encodeURIComponent(userScope)}`;
      const handle = setupReplication(database, {
        backendUrl,
        replicationScope,
        getToken: async () => await api.getConfig("accessToken"),
      });
      handleRef.current = handle;
      return handle;
    }
    return null;
  }

  const resetFromServer = useCallback(async () => {
    // Stop current replication
    handleRef.current?.cancel();
    handleRef.current = null;

    // Destroy local DB and recreate empty
    await destroyDatabase();
    const database = await getDatabase();

    // Set DB into React state immediately so UI rewires subscriptions
    setDb(database);

    // Restart replication — fresh DB means no checkpoint → full pull
    const handle = await startReplication(database);
    if (handle) {
      await handle.awaitInitialSync();
    }
  }, []);

  const cancelReplication = useCallback(() => {
    handleRef.current?.cancel();
    handleRef.current = null;
  }, []);

  const restartReplication = useCallback(async () => {
    handleRef.current?.cancel();
    handleRef.current = null;
    if (!db) return;
    const handle = await startReplication(db);
    if (handle) {
      await handle.awaitInitialSync();
    }
  }, [db]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const database = await getDatabase();
      if (cancelled) return;
      setDb(database);
      await startReplication(database);
    })();

    return () => {
      cancelled = true;
      handleRef.current?.cancel();
    };
  }, []);

  return (
    <DatabaseContext.Provider
      value={{ db, resetFromServer, cancelReplication, restartReplication }}
    >
      {children}
    </DatabaseContext.Provider>
  );
}

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { getDatabase, destroyDatabase, type SlateDatabase } from "./database";
import { setupReplication, type ReplicationHandle } from "./replication";

interface DatabaseContextValue {
  db: SlateDatabase | null;
  resetFromServer: () => Promise<void>;
}

const DatabaseContext = createContext<DatabaseContextValue>({ db: null, resetFromServer: async () => {} });

export function useDatabase(): SlateDatabase | null {
  return useContext(DatabaseContext).db;
}

export function useDatabaseReset(): () => Promise<void> {
  return useContext(DatabaseContext).resetFromServer;
}

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<SlateDatabase | null>(null);
  const handleRef = useRef<ReplicationHandle | null>(null);

  async function startReplication(database: SlateDatabase): Promise<ReplicationHandle | null> {
    const api = (window as any).slateDesktop;
    const backendUrl = await api?.getConfig("backendEndpoint");
    const token = await api?.getConfig("accessToken");

    if (backendUrl && token) {
      const handle = setupReplication(database, {
        backendUrl,
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

  return <DatabaseContext.Provider value={{ db, resetFromServer }}>{children}</DatabaseContext.Provider>;
}

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getDatabase, type SlateDatabase } from "./database";
import { setupReplication } from "./replication";

const DatabaseContext = createContext<SlateDatabase | null>(null);

export function useDatabase(): SlateDatabase | null {
  return useContext(DatabaseContext);
}

export function DatabaseProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<SlateDatabase | null>(null);

  useEffect(() => {
    let cleanup: (() => void) | null = null;

    (async () => {
      const database = await getDatabase();
      setDb(database);

      // Set up replication if backend is configured
      const api = (window as any).slateDesktop;
      const backendUrl = await api?.getConfig("backendEndpoint");
      const token = await api?.getConfig("accessToken");

      if (backendUrl && token) {
        cleanup = setupReplication(database, {
          backendUrl,
          getToken: async () => {
            return await api.getConfig("accessToken");
          },
        });
      }
    })();

    return () => {
      cleanup?.();
    };
  }, []);

  return <DatabaseContext.Provider value={db}>{children}</DatabaseContext.Provider>;
}

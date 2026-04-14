import { replicateRxCollection, type RxReplicationState } from "rxdb/plugins/replication";
import type { RxCollection } from "rxdb";
import { Subject } from "rxjs";
import type { SlateDatabase } from "./database";
import { noteConflictHandler } from "./conflict-handler";
import { useSyncStore } from "../stores/sync-store";

interface ReplicationConfig {
  backendUrl: string;
  getToken: () => Promise<string>;
}

export interface ReplicationHandle {
  cancel: () => void;
  awaitInitialSync: () => Promise<void>;
}

interface Checkpoint {
  id: string;
  updatedAt: string;
}

/**
 * Set up replication for all collections in the database.
 * Returns a cleanup function that cancels all replications.
 */
export function setupReplication(db: SlateDatabase, config: ReplicationConfig): ReplicationHandle {
  const replications: RxReplicationState<any, Checkpoint>[] = [];

  replications.push(setupCollectionReplication(db.notes, "notes", config, noteConflictHandler));
  replications.push(setupCollectionReplication(db.folders, "folders", config));
  replications.push(setupCollectionReplication(db.settings, "settings", config));

  return {
    cancel: () => {
      replications.forEach((r) => r.cancel());
    },
    awaitInitialSync: () =>
      Promise.race([
        Promise.all(replications.map((r) => r.awaitInitialReplication())).then(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 30_000)),
      ]),
  };
}

function setupCollectionReplication<T>(
  collection: RxCollection<T>,
  collectionName: string,
  config: ReplicationConfig,
  conflictHandler?: any,
): RxReplicationState<T, Checkpoint> {
  const pullStream$ = new Subject<any>();

  // SSE connection for live updates
  let eventSource: EventSource | null = null;

  async function connectSSE() {
    const token = await config.getToken();
    const url = `${config.backendUrl}/api/replication/${collectionName}/stream?token=${encodeURIComponent(token)}`;

    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // RxDB expects documents to have _deleted field
        const documents = (data.documents || []).map((doc: any) => ({
          ...doc,
          _deleted: doc.isDeleted ?? false,
        }));
        pullStream$.next({
          documents,
          checkpoint: data.checkpoint,
        });
      } catch {
        // Ignore parse errors from heartbeats
      }
    };

    eventSource.onerror = () => {
      if (eventSource?.readyState === EventSource.CLOSED) {
        setTimeout(() => connectSSE(), 5000);
      }
    };
  }

  connectSSE();

  const replication = replicateRxCollection<T, Checkpoint>({
    collection,
    replicationIdentifier: `slate-${collectionName}-replication`,
    live: true,
    retryTime: 5000,
    ...(conflictHandler ? { conflictHandler } : {}),

    push: {
      batchSize: 50,
      async handler(changeRows) {
        const token = await config.getToken();
        const response = await fetch(
          `${config.backendUrl}/api/replication/${collectionName}/push`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ changeRows }),
          },
        );

        if (!response.ok) {
          throw new Error(`Push failed: ${response.status}`);
        }

        const result = await response.json();
        return result.conflicts || [];
      },
    },

    pull: {
      batchSize: 100,
      async handler(lastCheckpoint: Checkpoint | undefined, batchSize: number) {
        const token = await config.getToken();
        const response = await fetch(
          `${config.backendUrl}/api/replication/${collectionName}/pull`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              checkpoint: lastCheckpoint ?? null,
              limit: batchSize,
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`Pull failed: ${response.status}`);
        }

        const result = await response.json();
        // RxDB expects documents to have _deleted field
        const documents = (result.documents || []).map((doc: any) => ({
          ...doc,
          _deleted: doc.isDeleted ?? false,
        }));

        return {
          documents,
          checkpoint: result.checkpoint,
        };
      },
      stream$: pullStream$.asObservable(),
    },
  });

  // Surface only user-actionable errors (e.g. expired auth).
  // Server errors and network blips are retried automatically by RxDB.
  const errorSub = replication.error$.subscribe((rxErr) => {
    const params = (rxErr as any).parameters as
      | { errors?: Array<{ message?: string }> }
      | undefined;
    const messages = params?.errors?.map((e) => e.message ?? "") ?? [rxErr.message];
    const combined = messages.join(" ");
    if (combined.includes("401") || combined.includes("403")) {
      useSyncStore.getState().setConnectionStatus("error");
      useSyncStore.getState().setConnectionError("Authentication expired. Please sign in again.");
    }
  });

  // Clean up SSE on replication cancel
  const originalCancel = replication.cancel.bind(replication);
  replication.cancel = () => {
    errorSub.unsubscribe();
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    pullStream$.complete();
    return originalCancel();
  };

  return replication;
}

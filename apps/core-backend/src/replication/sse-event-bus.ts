import { EventEmitter } from "node:events";

export interface ChangeEvent {
  collection: "notes" | "folders" | "settings";
  userId: string;
  documentId: string;
  operation: "INSERT" | "UPDATE" | "DELETE";
}

export class SseEventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(1000);
  }

  publish(event: ChangeEvent): void {
    this.emitter.emit(`change:${event.collection}:${event.userId}`, event);
  }

  subscribe(
    collection: "notes" | "folders" | "settings",
    userId: string,
    listener: (event: ChangeEvent) => void,
  ): () => void {
    const key = `change:${collection}:${userId}`;
    this.emitter.on(key, listener);
    return () => {
      this.emitter.off(key, listener);
    };
  }
}

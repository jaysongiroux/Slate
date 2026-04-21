import fs from "node:fs";
import path from "node:path";

async function readLogSlice(logPath, start, end) {
  if (end <= start) return "";
  const handle = await fs.promises.open(logPath, "r");
  try {
    const length = end - start;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function statSize(logPath) {
  try {
    const stats = await fs.promises.stat(logPath);
    return stats.size;
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
}

export async function createDesktopLogStream({
  logPath,
  send,
  maxInitialBytes = 96 * 1024,
  watchFile = fs.watch,
} = {}) {
  if (!logPath) throw new Error("logPath is required");
  if (typeof send !== "function") throw new Error("send callback is required");

  await fs.promises.mkdir(path.dirname(logPath), { recursive: true });
  await fs.promises.appendFile(logPath, "", "utf8");

  let offset = await statSize(logPath);
  const initialStart = Math.max(0, offset - maxInitialBytes);
  const initialChunk = await readLogSlice(logPath, initialStart, offset);
  send({ type: "initial", chunk: initialChunk, path: logPath });

  let reading = Promise.resolve();

  async function readAppendedBytes() {
    const nextSize = await statSize(logPath);
    if (nextSize === offset) return;

    const wasReset = nextSize < offset;
    const start = wasReset ? 0 : offset;
    const chunk = await readLogSlice(logPath, start, nextSize);
    offset = nextSize;

    if (chunk) {
      send({ type: wasReset ? "initial" : "append", chunk, path: logPath });
    }
  }

  const notifyChange = () => {
    reading = reading.then(readAppendedBytes, readAppendedBytes).catch(() => {});
    return reading;
  };

  const watcher = watchFile(logPath, notifyChange);

  return {
    path: logPath,
    close() {
      watcher?.close?.();
    },
  };
}

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createDesktopLogStream } from "./desktop-log-stream.mjs";

async function withTempLog(fn) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "slate-log-stream-"));
  const logPath = path.join(dir, "slate-desktop.log");
  try {
    return await fn(logPath);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

test("desktop log stream sends initial tail and appended log bytes without polling", async () => {
  await withTempLog(async (logPath) => {
    await fs.promises.writeFile(logPath, "first\nsecond\n", "utf8");
    const events = [];
    let watchStarted = false;
    let changeHandler = null;

    const stream = await createDesktopLogStream({
      logPath,
      maxInitialBytes: 64,
      send: (event) => events.push(event),
      watchFile: (targetPath, handler) => {
        watchStarted = true;
        assert.equal(targetPath, logPath);
        changeHandler = handler;
        return { close() {} };
      },
    });

    assert.equal(stream.path, logPath);
    assert.equal(watchStarted, true);
    assert.deepEqual(events, [{ type: "initial", chunk: "first\nsecond\n", path: logPath }]);

    await fs.promises.appendFile(logPath, "third\n", "utf8");
    await changeHandler();

    assert.deepEqual(events.at(-1), { type: "append", chunk: "third\n", path: logPath });
  });
});

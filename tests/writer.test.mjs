import assert from "node:assert/strict";
import { test } from "node:test";
import { createCheckpointWriter } from "../extension/lib/recording.mjs";

/** An in-memory FileSystemFileHandle double that only commits on close. */
function diskFile() {
  let committed = "";
  const openings = [];
  return {
    openings,
    contents: () => committed,
    async createWritable(options) {
      openings.push(options);
      let pending = options?.keepExistingData ? committed : "";
      let position = 0;
      return {
        async seek(offset) { position = offset; },
        async write(blob) {
          const text = await blob.text();
          pending = pending.slice(0, position) + text + pending.slice(position + text.length);
          position += text.length;
        },
        async close() { committed = pending; },
        async abort() {},
      };
    },
  };
}

test("periodic commits append at the correct offset and final close saves the tail", async (t) => {
  let time = 0;
  t.mock.method(Date, "now", () => time);
  const file = diskFile();
  const checkpoints = [];
  const writer = await createCheckpointWriter(file, { intervalMs: 100, onCheckpoint: (value) => checkpoints.push(value) });

  await writer.write(new Blob(["header"]));
  assert.equal(file.contents(), "", "nothing reaches disk before the first commit");
  time = 100;
  await writer.write(new Blob(["fragment1"]));
  assert.equal(file.contents(), "headerfragment1");
  time = 110;
  await writer.write(new Blob(["fragment2"]));
  assert.equal(file.contents(), "headerfragment1", "the interval has not elapsed again");
  await writer.close();
  assert.equal(file.contents(), "headerfragment1fragment2");
  assert.deepEqual(file.openings, [undefined, { keepExistingData: true }]);
  assert.equal(checkpoints.length, 2);
  assert.equal(checkpoints[1].bytes, 24);
});

test("closing twice is harmless and aborting retains committed data", async (t) => {
  let time = 0;
  t.mock.method(Date, "now", () => time);
  const file = diskFile();
  const writer = await createCheckpointWriter(file, { intervalMs: 100 });
  time = 100;
  await writer.write(new Blob(["saved"]));
  await writer.write(new Blob(["unsaved"]));
  await writer.abort();
  await writer.abort();
  assert.equal(file.contents(), "saved");
  await writer.close();
  assert.equal(file.contents(), "saved", "close after abort does not reopen");
});

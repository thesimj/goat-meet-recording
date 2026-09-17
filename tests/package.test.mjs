import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { inflateRawSync } from "node:zlib";
import { buildZip, collectEntries, crc32, packageExtension } from "../scripts/package.mjs";

/** Read a ZIP through its central directory, the way an unpacker does. */
function readZip(zip) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "end of central directory record");
  const count = zip.readUInt16LE(end + 10);
  let position = zip.readUInt32LE(end + 16);
  const files = new Map();
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(position), 0x02014b50, "central header signature");
    const method = zip.readUInt16LE(position + 10);
    const crc = zip.readUInt32LE(position + 16);
    const compressed = zip.readUInt32LE(position + 20);
    const size = zip.readUInt32LE(position + 24);
    const nameLength = zip.readUInt16LE(position + 28);
    const localOffset = zip.readUInt32LE(position + 42);
    const name = zip.toString("utf8", position + 46, position + 46 + nameLength);
    position += 46 + nameLength;

    assert.equal(zip.readUInt32LE(localOffset), 0x04034b50, `local header for ${name}`);
    const localNameLength = zip.readUInt16LE(localOffset + 26);
    const localExtraLength = zip.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const payload = zip.subarray(start, start + compressed);
    const data = method === 8 ? inflateRawSync(payload) : Buffer.from(payload);
    assert.equal(data.length, size, `size of ${name}`);
    assert.equal(crc32(data), crc, `crc of ${name}`);
    files.set(name, data);
  }
  return files;
}

test("crc32 matches the reference value for a known string", () => {
  assert.equal(crc32(Buffer.from("The quick brown fox jumps over the lazy dog")), 0x414fa339);
  assert.equal(crc32(Buffer.alloc(0)), 0);
});

test("buildZip round-trips stored and deflated entries", () => {
  const tiny = Buffer.from("{}");
  const text = Buffer.from("goat ".repeat(500));
  const zip = buildZip([
    { name: "manifest.json", data: tiny, mtime: new Date(2026, 8, 17, 12, 34, 56) },
    { name: "lib/big.mjs", data: text, mtime: new Date(2026, 8, 17) },
  ]);
  const files = readZip(zip);
  assert.deepEqual([...files.keys()], ["manifest.json", "lib/big.mjs"]);
  assert.ok(files.get("manifest.json").equals(tiny));
  assert.ok(files.get("lib/big.mjs").equals(text));
  assert.ok(zip.length < text.length, "the repeated text was compressed");
});

test("the store package holds exactly the extension files with the manifest at the root", async () => {
  const distDir = await mkdtemp(path.join(os.tmpdir(), "goatmeet-dist-"));
  try {
    const result = await packageExtension({ distDir });
    assert.match(path.basename(result.target), /^goatmeet-\d+(\.\d+)*\.zip$/);
    const files = readZip(await readFile(result.target));
    const expected = (await collectEntries()).map((entry) => entry.name);
    assert.deepEqual([...files.keys()], expected);
    assert.ok(files.has("manifest.json"));
    assert.ok(files.has("background.js"));
    assert.ok(files.has("icons/goat128.png"));
    assert.ok(![...files.keys()].some((name) => /test|README|\.md$/i.test(name)));
    const manifest = JSON.parse(files.get("manifest.json").toString("utf8"));
    assert.equal(manifest.version, result.version);
  } finally {
    await rm(distDir, { recursive: true, force: true });
  }
});

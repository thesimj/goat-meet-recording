#!/usr/bin/env node
// Build the Chrome Web Store upload: dist/goatmeet-<version>.zip with manifest.json at the root.
// Pure Node, no dependencies. The ZIP writer supports the store and deflate methods only.
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const EXTENSION_DIR = path.join(ROOT, "extension");
export const DIST_DIR = path.join(ROOT, "dist");

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** MS-DOS date and time fields, as the ZIP format requires. */
function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/**
 * Build a ZIP archive in memory.
 * @param {{name: string, data: Buffer, mtime?: Date}[]} entries forward-slash names, sorted by the caller
 * @returns {Buffer}
 */
export function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const deflated = deflateRawSync(entry.data, { level: 9 });
    const useDeflate = deflated.length < entry.data.length;
    const payload = useDeflate ? deflated : entry.data;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(entry.data);
    const { time, day } = dosDateTime(entry.mtime || new Date());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, payload);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + payload.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, ...centrals, end]);
}

async function walk(directory, base = directory) {
  const names = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of names) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full, base)));
    else files.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return files.sort();
}

/** Collect the extension files as ZIP entries, manifest.json first. */
export async function collectEntries(directory = EXTENSION_DIR) {
  const names = await walk(directory);
  if (!names.includes("manifest.json")) throw new Error(`No manifest.json in ${directory}`);
  const entries = [];
  for (const name of names) {
    const full = path.join(directory, name);
    const [data, info] = await Promise.all([readFile(full), stat(full)]);
    entries.push({ name, data, mtime: info.mtime });
  }
  return entries;
}

export async function packageExtension({ extensionDir = EXTENSION_DIR, distDir = DIST_DIR } = {}) {
  const manifest = JSON.parse(await readFile(path.join(extensionDir, "manifest.json"), "utf8"));
  const entries = await collectEntries(extensionDir);
  const zip = buildZip(entries);
  await mkdir(distDir, { recursive: true });
  const target = path.join(distDir, `goatmeet-${manifest.version}.zip`);
  await writeFile(target, zip);
  return { target, version: manifest.version, entries: entries.map((entry) => entry.name), bytes: zip.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await packageExtension();
  console.log(`GoatMeet ${result.version}: ${result.entries.length} files, ${result.bytes} bytes`);
  for (const name of result.entries) console.log(`  ${name}`);
  console.log(`-> ${path.relative(process.cwd(), result.target)}`);
}

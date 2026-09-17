#!/usr/bin/env node
// Syntax-check every script and validate every JSON file. Runs in CI before the tests.
import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SKIP = new Set(["node_modules", "dist", ".git"]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

const files = await walk(ROOT);
const problems = [];

// Every file is independent, so the syntax checks and JSON parses run concurrently.
await Promise.all([
  ...files.filter((name) => /\.(m?js)$/.test(name)).map(async (file) => {
    try {
      await run(process.execPath, ["--check", file]);
    } catch (error) {
      problems.push(`${path.relative(ROOT, file)}: ${error.stderr?.toString().trim() || error.message}`);
    }
  }),
  ...files.filter((name) => name.endsWith(".json")).map(async (file) => {
    try {
      JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      problems.push(`${path.relative(ROOT, file)}: ${error.message}`);
    }
  }),
]);
problems.sort();

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`Checked ${files.length} files. No syntax problems.`);

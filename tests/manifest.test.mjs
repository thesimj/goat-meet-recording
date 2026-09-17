// Structural checks that catch broken references before Chrome or the store does.
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../extension/", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));

async function exists(relative) {
  try {
    await stat(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  }));
  return files.flat();
}

test("manifest follows Manifest V3 and Chrome Web Store limits", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.match(manifest.version, /^\d+(\.\d+){0,3}$/);
  assert.ok(manifest.description.length <= 132, `description is ${manifest.description.length} characters`);
  assert.ok(manifest.name.length <= 75);
  assert.equal(manifest.background.type, "module");
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
  assert.match(manifest.homepage_url, /^https:\/\/github\.com\//);
});

test("permissions stay minimal: no tabs, no host permissions, no storage", () => {
  assert.deepEqual([...manifest.permissions].sort(), ["activeTab", "offscreen", "tabCapture"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.optional_permissions, undefined);
});

test("every file the manifest references exists", async () => {
  const referenced = [
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    manifest.action.default_popup,
    manifest.options_page,
    manifest.background.service_worker,
    "offscreen.html",
  ];
  for (const file of referenced) assert.ok(await exists(file), file);
});

test("every script, stylesheet, and relative import resolves to a file", async () => {
  const files = await walk(root);
  const problems = [];
  for (const file of files) {
    const relativeDir = path.relative(root, path.dirname(file));
    const source = await readFile(file, "utf8").catch(() => "");
    const references = [];
    if (file.endsWith(".html")) {
      for (const [, href] of source.matchAll(/(?:src|href)="([^"]+)"/g)) references.push(href);
    } else if (/\.(mjs|js)$/.test(file)) {
      for (const [, specifier] of source.matchAll(/from\s+"(\.[^"]+)"/g)) references.push(specifier);
    }
    for (const reference of references) {
      const target = path.normalize(path.join(relativeDir, reference));
      if (!(await exists(target))) problems.push(`${path.relative(root, file)} -> ${reference}`);
    }
  }
  assert.deepEqual(problems, []);
});

test("the extension folder contains no test, documentation, or media files", async () => {
  const files = (await walk(root)).map((file) => path.relative(root, file));
  const allowed = /\.(js|mjs|html|css|json|png)$/;
  const unexpected = files.filter((file) => !allowed.test(file) || /test|\.md$/.test(file));
  assert.deepEqual(unexpected, []);
});

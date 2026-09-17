// Run an extension page script inside a Node vm context with fake browser globals.
// Imports are stripped from the source. Every imported name must be supplied through
// the context: pure helpers come from the real modules, browser-facing ones are stubs.
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as shared from "../../extension/lib/shared.mjs";
import { reply } from "../../extension/lib/messaging.mjs";

const EXTENSION_ROOT = new URL("../../extension/", import.meta.url);

/** A minimal DOM element double that records handlers and attributes. */
export function fakeElement(id) {
  const classes = new Set();
  return {
    id,
    hidden: false,
    disabled: false,
    textContent: "",
    title: "",
    value: "",
    checked: false,
    attributes: {},
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      toggle: (name, force) => (force ?? !classes.has(name)) ? classes.add(name) : classes.delete(name),
      contains: (name) => classes.has(name),
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(type, handler) { this[type] = handler; },
  };
}

/** Build fake elements for every id in an extension HTML file, keeping each element's markup text. */
export async function elementsOf(htmlFile) {
  const html = await readFile(new URL(htmlFile, EXTENSION_ROOT), "utf8");
  const entries = [...html.matchAll(/id="([^"]+)"[^>]*>([^<]*)/g)].map(([, id, text]) => {
    const element = fakeElement(id);
    element.textContent = text.trim();
    return [id, element];
  });
  return Object.fromEntries(entries);
}

/** Every selector the pages use resolves to the same element set. */
export function fakeDocument(ui) {
  return { querySelectorAll: () => Object.values(ui) };
}

/**
 * Load a page script, strip its imports, and run it with the given globals.
 * @param {string} scriptFile path relative to extension/, e.g. "popup.mjs"
 * @param {object} globals names the script expects, on top of the shared helpers
 * @param {string[]} expose local names to return from the script scope
 */
export async function runPage(scriptFile, globals, expose = []) {
  const raw = await readFile(new URL(scriptFile, EXTENSION_ROOT), "utf8");
  const source = raw.replace(/^import\s[\s\S]*?\sfrom\s"[^"]+";\r?\n/gm, "");
  if (/^import\s/m.test(source)) throw new Error(`Unstripped import in ${scriptFile}`);
  const context = vm.createContext({ ...shared, reply, console, Promise, Error, Number, Boolean, String, Date, Math, Object, ...globals });
  const wrapped = `(async () => { ${source}\nreturn { ${expose.join(", ")} }; })()`;
  return vm.runInContext(wrapped, context, { filename: scriptFile });
}

/** Let queued microtasks and timers settle. */
export async function settle(rounds = 5) {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve));
}

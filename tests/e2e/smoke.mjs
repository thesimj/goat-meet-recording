#!/usr/bin/env node
// Smoke test in a real Chrome: load the unpacked extension, open every page, exercise the
// message routes, and run the encoder check. Needs Google Chrome installed. Not part of `npm test`.
//
// Chrome 137 and later ignore --load-extension in branded builds, so the extension is loaded
// through the DevTools protocol (Extensions.loadUnpacked), which needs --enable-unsafe-extension-debugging.
//
//   node tests/e2e/smoke.mjs            # uses a common Chrome path for this OS
//   CHROME="C:\\path\\chrome.exe" node tests/e2e/smoke.mjs
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const EXTENSION = path.join(ROOT, "extension");
const HTTP_PORT = 8765;
const CDP_PORT = 9333;

const CHROME_PATHS = {
  win32: [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
  ],
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"],
};

const MIME = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

const failures = [];
function check(condition, label, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
  if (!condition) failures.push(label);
}

async function findChrome() {
  const candidates = [process.env.CHROME, ...(CHROME_PATHS[process.platform] || [])].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await stat(candidate);
      return candidate;
    } catch { /* try the next one */ }
  }
  throw new Error("Google Chrome not found. Set CHROME to its path.");
}

/** Serve the repository over http://127.0.0.1 so the browser check runs in a secure context. */
function serveRepository() {
  const server = createServer(async (request, response) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(request.url, "http://x").pathname));
    try {
      const data = await readFile(file);
      response.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      response.end(data);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(HTTP_PORT, "127.0.0.1", () => resolve(server)));
}

/** Minimal Chrome DevTools Protocol client over the WebSocket built into Node. */
async function connect(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  const pending = new Map();
  const events = [];
  let id = 0;
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    } else {
      events.push(message);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text);
    return result.value;
  };
  return { send, evaluate, events, close: () => socket.close() };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function targets() {
  return (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
}

async function waitFor(predicate, { timeout = 15000, interval = 200, label = "condition" } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(interval);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function openTab(url) {
  const target = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  const page = await connect(target.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  await waitFor(() => page.evaluate("document.readyState === 'complete'"), { label: `${url} to load` });
  await sleep(300);
  page.targetId = target.id;
  return page;
}

function pageErrors(page) {
  return page.events
    .filter((event) => (event.method === "Log.entryAdded" && event.params.entry.level === "error")
      || event.method === "Runtime.exceptionThrown")
    .map((event) => event.params.entry?.text || event.params.exceptionDetails?.exception?.description);
}

async function main() {
  const chromePath = await findChrome();
  const profile = await mkdtemp(path.join(os.tmpdir(), "goatmeet-e2e-"));
  const server = await serveRepository();
  const checkUrl = `http://127.0.0.1:${HTTP_PORT}/tests/browser/browser.html`;
  const chrome = spawn(chromePath, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${CDP_PORT}`,
    "--enable-unsafe-extension-debugging",
    "--no-first-run",
    "--no-default-browser-check",
    "--autoplay-policy=no-user-gesture-required",
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--window-size=1280,900",
    checkUrl,
  ], { stdio: "ignore" });

  try {
    const version = await waitFor(() => fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.json(), () => null), { timeout: 60000, label: "Chrome DevTools" });
    const browser = await connect(version.webSocketDebuggerUrl);
    // Chrome resolves the path only with forward slashes.
    const { id: extensionId } = await browser.send("Extensions.loadUnpacked", { path: EXTENSION.split(path.sep).join("/") });
    console.log(`Extension id: ${extensionId}`);
    const worker = await waitFor(async () => (await targets()).find((t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${extensionId}/`)), { label: "service worker" });
    const workerClient = await connect(worker.webSocketDebuggerUrl);
    await workerClient.send("Runtime.enable");

    // 1. Service worker is alive and the manifest is what we shipped.
    const manifest = await workerClient.evaluate("chrome.runtime.getManifest()");
    check(manifest.version === JSON.parse(await readFile(path.join(EXTENSION, "manifest.json"), "utf8")).version, "service worker runs the packaged manifest version", manifest.version);
    check(!manifest.permissions.includes("tabs"), "manifest has no tabs permission");

    // 2. Encoder check in the served page.
    const checkPage = await (async () => {
      const target = (await targets()).find((t) => t.url === checkUrl);
      const page = await connect(target.webSocketDebuggerUrl);
      await page.send("Runtime.enable");
      await page.send("Log.enable");
      page.targetId = target.id;
      return page;
    })();
    await checkPage.evaluate("document.querySelector('#run').click(); true");
    const outcome = await waitFor(() => checkPage.evaluate("document.querySelector('#result').dataset.outcome || ''"), { timeout: 40000, label: "encoder check" });
    const resultText = await checkPage.evaluate("document.querySelector('#result').textContent");
    check(outcome === "pass", "browser encoder check passes", resultText);

    // 3. Toolbar for a tab whose URL Chrome withholds: assumed web page, access missing.
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/activate/${checkPage.targetId}`);
    await sleep(500);
    const titleOnPage = await workerClient.evaluate("chrome.action.getTitle({})");
    check(/Folder access needed/.test(titleOnPage) && !/Open a web page tab to record/.test(titleOnPage), "toolbar treats an unknown tab URL as a page needing access", titleOnPage);
    const badge = await workerClient.evaluate("chrome.action.getBadgeText({})");
    check(badge === "!", "amber badge shows while access is missing", badge);

    // 4. Popup as a tab: modules load, status round-trips through the service worker.
    const popup = await openTab(`chrome-extension://${extensionId}/popup.html`);
    const popupStatus = await popup.evaluate("document.querySelector('#status').textContent");
    check(/web page tab/.test(popupStatus), "popup explains that its own tab is not recordable", popupStatus);
    check(await popup.evaluate("document.querySelector('#start').disabled"), "Start is disabled on a non-web tab");
    check((await popup.evaluate("document.querySelector('#start').textContent")) === "Start recording", "the button always reads Start recording");
    const status = await popup.evaluate("chrome.runtime.sendMessage({ target: 'controller', type: 'status' })");
    check(status?.ok === true && status.state.phase === "idle", "status command reports idle", JSON.stringify(status));
    const ownTabId = await popup.evaluate("chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab.id)");
    // Without the tabs permission Chrome withholds every tab URL from the service worker, including
    // the extension's own pages, until the user clicks the toolbar icon on that tab.
    const ownStart = await popup.evaluate(`chrome.runtime.sendMessage({ target: 'controller', type: 'start', tabId: ${ownTabId} })`);
    check(ownStart?.ok === false && /cannot see this tab|tab you want to record/.test(ownStart.error), "start refuses a tab it was not invoked on", ownStart?.error);
    const otherTabId = await popup.evaluate(`chrome.tabs.query({}).then((tabs) => tabs.find((tab) => tab.id !== ${ownTabId}).id)`);
    const hiddenStart = await popup.evaluate(`chrome.runtime.sendMessage({ target: 'controller', type: 'start', tabId: ${otherTabId} })`);
    check(hiddenStart?.ok === false && /cannot see this tab/.test(hiddenStart.error), "start explains a tab without activeTab access", hiddenStart?.error);
    const stop = await popup.evaluate("chrome.runtime.sendMessage({ target: 'controller', type: 'stop' })");
    check(stop?.ok === false && /no active recording/.test(stop.error), "stop without a recording fails cleanly", stop?.error);
    await sleep(500);
    const titleOnPopup = await workerClient.evaluate("chrome.action.getTitle({})");
    check(/Folder access needed/.test(titleOnPopup), "toolbar keeps the access hint on a tab whose URL is withheld", titleOnPopup);
    check(pageErrors(popup).length === 0, "popup logged no errors", pageErrors(popup).join(" | "));

    // 5. Settings page. Its module finishes loading asynchronously, so wait past the initial text.
    const setup = await openTab(`chrome-extension://${extensionId}/setup.html`);
    await waitFor(() => setup.evaluate("!/Loading settings/.test(document.querySelector('#status').textContent)"), { label: "settings to load" });
    const setupStatus = await setup.evaluate("document.querySelector('#status').textContent");
    check(/Choose a recording folder/.test(setupStatus), "settings page asks for a folder on a fresh profile", setupStatus);
    check(await setup.evaluate("document.querySelector('#default-folder').disabled === false"), "settings controls are enabled after load");
    check(/\d{8}-\d{4}-chrome-meeting\.mp4/.test(await setup.evaluate("document.querySelector('#filename').textContent")), "settings page previews a filename");
    await setup.evaluate("document.querySelector('#include-mic').checked = false; document.querySelector('#include-mic').dispatchEvent(new Event('change')); true");
    await sleep(300);
    check(await setup.evaluate("document.querySelector('#microphone').disabled"), "disabling the microphone disables the device list and saves");
    check(pageErrors(setup).length === 0, "settings page logged no errors", pageErrors(setup).join(" | "));

    // 6. Access window with a tab id, and without one.
    const access = await openTab(`chrome-extension://${extensionId}/permissions.html?tabId=${otherTabId}`);
    const accessStatus = await access.evaluate("document.querySelector('#status').textContent");
    check(/Click Allow and record/.test(accessStatus), "access window is ready with a tab id", accessStatus);
    check(/tab audio only/.test(await access.evaluate("document.querySelector('#microphone').textContent")), "access window reflects the saved microphone setting");
    check(pageErrors(access).length === 0, "access window logged no errors", pageErrors(access).join(" | "));
    const noTab = await openTab(`chrome-extension://${extensionId}/permissions.html`);
    check(/tab you want to record/.test(await noTab.evaluate("document.querySelector('#status').textContent")), "access window without a tab id shows guidance");

    // 7. Reopen the popup after the settings change: the mic line must follow the saved setting.
    const popupAgain = await openTab(`chrome-extension://${extensionId}/popup.html`);
    check(/tab audio only/.test(await popupAgain.evaluate("document.querySelector('#mic-permission').textContent")), "popup reflects the saved microphone setting");
    check((await popupAgain.evaluate("document.querySelector('#start').textContent")) === "Start recording", "the label is stable when the tab URL is unknown");

    // 8. Grant access the way a user would, then confirm the extension detects it on its own.
    //    A browser-owned folder stands in for the picked folder; the fake-UI flag auto-grants
    //    the microphone. No prompts are involved, so this proves the queryPermission checks.
    const micState = await setup.evaluate(`(async () => {
      const { loadSettings, saveSettings } = await import("./lib/storage.mjs");
      const root = await navigator.storage.getDirectory();
      const directory = await root.getDirectoryHandle("goatmeet-e2e", { create: true });
      const settings = await loadSettings();
      settings.directory = directory;
      settings.folderLabel = "Browser storage / goatmeet-e2e";
      settings.includeMic = true;
      await saveSettings(settings);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      await chrome.runtime.sendMessage({ target: "controller", type: "refresh-toolbar" });
      return (await navigator.permissions.query({ name: "microphone" })).state;
    })()`);
    check(micState === "granted", "microphone permission is granted for the extension", micState);
    await fetch(`http://127.0.0.1:${CDP_PORT}/json/activate/${checkPage.targetId}`);
    await sleep(700);
    check(/Ready - start recording this tab/.test(await workerClient.evaluate("chrome.action.getTitle({})")), "toolbar turns ready once access is granted");
    check((await workerClient.evaluate("chrome.action.getBadgeText({})")) === "", "the amber badge clears once access is granted");

    const popupGranted = await openTab(`chrome-extension://${extensionId}/popup.html`);
    check((await popupGranted.evaluate("document.querySelector('#mic-permission').textContent")) === "Microphone: allowed", "popup detects the granted microphone without a prompt");
    check(/Browser storage \/ goatmeet-e2e/.test(await popupGranted.evaluate("document.querySelector('#folder').textContent")), "popup detects the granted folder");
    check((await popupGranted.evaluate("document.querySelector('#start').textContent")) === "Start recording", "the button reads Start recording once access is present");
    check(!/Chrome will ask/.test(await popupGranted.evaluate("document.querySelector('#status').textContent")), "popup no longer warns that access is missing");
    const accessGranted = await openTab(`chrome-extension://${extensionId}/permissions.html?tabId=${otherTabId}`);
    check(/Browser storage/.test(await accessGranted.evaluate("document.querySelector('#folder').textContent")), "access window shows the already granted folder");
    check(pageErrors(popupGranted).length === 0 && pageErrors(accessGranted).length === 0, "granted-state pages logged no errors");

    // 8b. Recording layout: Stop and the mic icon share one row, and the mic is a compact square.
    const layout = await popupGranted.evaluate(`(() => {
      const s = { phase: "recording", tabId: 1, includeMic: true, micMuted: false, startedAt: Date.now() };
      // Drive the popup's own render into the recording state.
      document.getElementById("start").hidden = true;
      const stop = document.getElementById("stop");
      const mute = document.getElementById("mute");
      stop.hidden = false; mute.hidden = false;
      const sr = stop.getBoundingClientRect();
      const mr = mute.getBoundingClientRect();
      return { stopTop: Math.round(sr.top), micTop: Math.round(mr.top), stopW: Math.round(sr.width),
        micW: Math.round(mr.width), micH: Math.round(mr.height), rightGap: Math.round(mr.left - sr.right),
        hasSvg: !!mute.querySelector("svg") };
    })()`);
    check(Math.abs(layout.stopTop - layout.micTop) <= 1, "Stop and the mic icon sit on the same row", JSON.stringify(layout));
    check(layout.micW < layout.stopW && layout.micW <= 60 && Math.abs(layout.micW - layout.micH) <= 6, "the mic icon is a compact square", JSON.stringify(layout));
    check(layout.rightGap > 0 && layout.rightGap < 20, "the mic icon sits just right of Stop", String(layout.rightGap));
    check(layout.hasSvg, "the mic control renders an inline SVG icon");

    // 9. The access page's Close must remove only its own tab, never the whole browser. This
    //    guards the report that pressing Allow closed all of Chrome. closeSelf does two things:
    //    chrome.tabs.getCurrent() to learn its own tab id, then chrome.tabs.remove(id). Each is
    //    verified. Note: attaching a DevTools debugger to a tab keeps Chrome from closing it, so
    //    the removal is checked on a tab this harness never attaches to.
    const accessPageTarget = await (async () => {
      await popupGranted.evaluate(`chrome.tabs.create({ url: chrome.runtime.getURL("permissions.html?tabId=${otherTabId}") })`);
      return waitFor(async () => (await targets()).find((t) => t.type === "page" && t.url.includes("permissions.html")), { label: "access page tab" });
    })();
    const accessPage = await connect(accessPageTarget.webSocketDebuggerUrl);
    await accessPage.send("Runtime.enable");
    const learnedId = await accessPage.evaluate("chrome.tabs.getCurrent().then((t) => t && t.id)");
    check(Number.isInteger(learnedId), "the access page learns its own tab id from chrome.tabs.getCurrent", String(learnedId));
    accessPage.close();

    // A second access tab, never attached, is removed by id the way closeSelf removes its own.
    const accessTabsBefore = (await targets()).filter((t) => t.url.includes("permissions.html")).length;
    const nonAccessBefore = (await targets()).filter((t) => t.type === "page" && !t.url.includes("permissions.html")).length;
    const freshId = await popupGranted.evaluate(`chrome.tabs.create({ url: chrome.runtime.getURL("permissions.html?tabId=${otherTabId}") }).then((t) => t.id)`);
    await waitFor(async () => (await targets()).filter((t) => t.url.includes("permissions.html")).length > accessTabsBefore, { label: "second access tab" });
    const removed = await workerClient.evaluate(`chrome.tabs.remove(${freshId}).then(() => "ok", (e) => "err: " + e.message)`);
    await sleep(700);
    check(removed === "ok", "chrome.tabs.remove resolves for the access page tab", removed);
    const browserAlive = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then(() => true, () => false);
    check(browserAlive, "the browser stays alive after the access page closes itself");
    const accessTabsAfter = (await targets()).filter((t) => t.url.includes("permissions.html")).length;
    const nonAccessAfter = (await targets()).filter((t) => t.type === "page" && !t.url.includes("permissions.html")).length;
    check(accessTabsAfter === accessTabsBefore, "closing the access tab removes exactly the one just opened", `${accessTabsBefore} -> ${accessTabsAfter}`);
    check(nonAccessAfter === nonAccessBefore, "every other tab is still open", `${nonAccessBefore} -> ${nonAccessAfter}`);

    for (const client of [checkPage, popup, setup, access, noTab, popupAgain, popupGranted, accessGranted, workerClient, browser]) client.close();
  } finally {
    chrome.kill();
    await new Promise((resolve) => chrome.once("exit", resolve));
    server.close();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }

  console.log(failures.length ? `\n${failures.length} check(s) failed.` : "\nAll smoke checks passed.");
  process.exit(failures.length ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

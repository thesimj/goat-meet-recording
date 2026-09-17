// Settings live in the extension's own IndexedDB database.
// IndexedDB can hold a FileSystemDirectoryHandle, which chrome.storage cannot.

const DATABASE = "goatmeet";
const STORE = "settings";
const KEY = "preferences";

const DEFAULTS = Object.freeze({ includeMic: true, deviceId: "" });

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withDatabase(task) {
  const db = await openDatabase();
  try {
    return await task(db);
  } finally {
    db.close();
  }
}

/**
 * Load the saved preferences merged over the defaults.
 * @returns {Promise<{includeMic: boolean, deviceId: string, directory?: FileSystemDirectoryHandle,
 *   folderLabel?: string, folderPath?: string}>}
 */
export function loadSettings() {
  return withDatabase((db) => new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(KEY);
    request.onsuccess = () => resolve({ ...DEFAULTS, ...request.result });
    request.onerror = () => reject(request.error);
  }));
}

export function saveSettings(settings) {
  return withDatabase((db) => new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(settings, KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Settings could not be saved."));
  }));
}

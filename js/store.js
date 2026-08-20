/* store.js — bit:* namespaced storage with in-memory fallback.
   All student data lives here and only here. Nothing ever leaves the device. */

const PREFIX = "bit:";

function safeStorage(name) {
  // even the property ACCESS throws under blocked-storage privacy modes
  try { return window[name] || null; } catch { return null; }
}

function probe(storage) {
  if (!storage) return false;
  try {
    const k = PREFIX + "__probe";
    storage.setItem(k, "1");
    storage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

const localStore = safeStorage("localStorage");
const sessionStore = safeStorage("sessionStorage");
const localOK = probe(localStore);
const sessionOK = probe(sessionStore);

const memLocal = new Map();
const memSession = new Map();

function makeAPI(storage, ok, mem) {
  return {
    get(key) {
      try {
        const raw = ok ? storage.getItem(PREFIX + key) : mem.get(PREFIX + key);
        return raw == null ? null : JSON.parse(raw);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        const raw = JSON.stringify(value);
        if (ok) storage.setItem(PREFIX + key, raw);
        else mem.set(PREFIX + key, raw);
        return true;
      } catch {
        // quota filled mid-session: surface the same gentle banner the
        // blocked-storage path shows, instead of silently losing drafts
        store.available = false;
        if (typeof store.onWriteError === "function") { try { store.onWriteError(); } catch { /* banner is best-effort */ } }
        return false;
      }
    },
    remove(key) {
      try {
        if (ok) storage.removeItem(PREFIX + key);
        else mem.delete(PREFIX + key);
      } catch { /* ignore */ }
    },
    clear() {
      try {
        if (ok) {
          const doomed = [];
          for (let i = 0; i < storage.length; i++) {
            const k = storage.key(i);
            if (k && k.startsWith(PREFIX)) doomed.push(k);
          }
          doomed.forEach((k) => storage.removeItem(k));
        }
        mem.clear();
      } catch { /* ignore */ }
    },
  };
}

export const store = {
  ...makeAPI(localStore, localOK, memLocal),
  session: makeAPI(sessionStore, sessionOK, memSession),
  /** false when private browsing / quota blocks persistence — UI shows one gentle banner */
  available: localOK,
  /** optional hook: fired once writes start failing mid-session (quota) */
  onWriteError: null,
  /** wipe every bit:* key in BOTH storages ("Delete everything") */
  clearAll() {
    this.clear();
    this.session.clear();
  },
};

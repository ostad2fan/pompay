// server/src/store.ts
// Simple JSON-file persistence layer replacing the Cloudflare Durable Object
// storage. Keeps everything in memory and flushes to disk (atomic write with
// tmp-file + rename) shortly after every change.

import fs from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

let state: Record<string, unknown> = {};
let loaded = false;
let saveTimer: NodeJS.Timeout | null = null;

function ensureDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load(): void {
  if (loaded) return;
  ensureDir();
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf-8");
      state = JSON.parse(raw) as Record<string, unknown>;
      console.log(`[Store] loaded state (${Object.keys(state).length} keys) from ${STATE_FILE}`);
    }
  } catch (e) {
    console.log("[Store] failed to load state, starting fresh:", e);
    state = {};
  }
  loaded = true;
}

function flushSync(): void {
  try {
    ensureDir();
    const tmp = STATE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state), "utf-8");
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    console.log("[Store] failed to persist state:", e);
  }
}

/** Debounced save — batches rapid writes into one disk flush. */
function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flushSync();
  }, 400);
}

const store = {
  async get<T>(key: string): Promise<T | null> {
    load();
    return (key in state ? (state[key] as T) : null);
  },

  async put(key: string, value: unknown): Promise<void> {
    load();
    state[key] = value;
    scheduleSave();
  },

  async delete(key: string): Promise<void> {
    load();
    delete state[key];
    scheduleSave();
  },

  /** Force an immediate flush (used on graceful shutdown). */
  flush(): void {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (loaded) flushSync();
  },
};

export default store;

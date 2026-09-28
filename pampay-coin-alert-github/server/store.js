/**
 * store.js — tiny JSON-file storage replacing Cloudflare Durable Object storage.
 * All data lives in DATA_DIR (default ./data). Safe against concurrent writes
 * within one process (synchronous write + atomic rename).
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function fileFor(key) {
  const safe = String(key).replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DATA_DIR, `${safe}.json`);
}

async function get(key, fallback = null) {
  try {
    const raw = fs.readFileSync(fileFor(key), 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function put(key, value) {
  const target = fileFor(key);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, target);
  return value;
}

async function del(key) {
  try {
    fs.unlinkSync(fileFor(key));
  } catch {}
}

async function pushRegister(token, platform) {
  const list = (await get('pushTokens', {})) || {};
  list[token] = { platform, at: Date.now() };
  const entries = Object.entries(list).slice(-500);
  await put('pushTokens', Object.fromEntries(entries));
}

async function pushUnregister(token) {
  const list = (await get('pushTokens', {})) || {};
  delete list[token];
  await put('pushTokens', list);
}

async function pushTokens() {
  return Object.keys((await get('pushTokens', {})) || {});
}

module.exports = { get, put, del, pushRegister, pushUnregister, pushTokens, DATA_DIR };

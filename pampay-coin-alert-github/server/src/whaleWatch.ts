// server/src/whaleWatch.ts
// v1.4.17 — 24/7 whale position monitor (Hyperliquid perp DEX).
//
// WHY: the app tracked whale addresses locally but NEVER notified on
// position changes while closed («آدرس نهنگ اضافه کردم اما اعلان بسته‌شدن
// پوزیشنش به تلگرام نیامد»). This module runs on the SERVER (every fast
// tick, ~10 min), compares each tracked whale's open positions against the
// previous snapshot and announces OPEN / CLOSE / SIZE-CHANGE events to
// Telegram + push — even with the app fully closed.
//
// Source: https://api.hyperliquid.xyz/info (keyless, public). The exact same
// wallet-detail screen data source the app already uses.

import store from "./store";
import { sendTelegram } from "./telegram";
import { sendPushToAll } from "./push";

export interface WhaleWalletConfig {
  id: string;
  address: string;
  label: string;
}

interface HlPosition {
  position: {
    coin: string;
    szi: string;
    entryPx: string | null;
    leverage: string | null;
    liquidationPx: string | null;
    positionValue: string;
    unrealizedPnl: string;
    side: "long" | "short";
  };
}

interface HlClearinghouseState {
  assetPositions: HlPosition[];
  marginSummary?: { accountValue?: string };
}

interface SnapshotPos {
  coin: string;
  size: number;
  side: "long" | "short";
  entryPx: number;
  value: number;
  pnl: number;
}

interface WhaleSnapshot {
  positions: SnapshotPos[];
  accountValue: number;
  at: number;
}

const SNAPSHOT_KEY = "whaleWatchSnapshots";
const NOTIFY_LOG_KEY = "whaleWatchNotifyLog";
const NOTIFY_LOG_MAX = 400;
const MIN_NOTIONAL_USD = 1_000; // ignore dust positions
const SNAP_MAX_AGE_MS = 6 * 3600_000;

async function getSnapshots(): Promise<Record<string, WhaleSnapshot>> {
  return (await store.get<Record<string, WhaleSnapshot>>(SNAPSHOT_KEY)) ?? {};
}

async function putSnapshots(map: Record<string, WhaleSnapshot>): Promise<void> {
  await store.put(SNAPSHOT_KEY, map);
}

async function wasNotified(key: string): Promise<boolean> {
  const log = (await store.get<Record<string, boolean>>(NOTIFY_LOG_KEY)) ?? {};
  return !!log[key];
}

async function markNotified(key: string): Promise<void> {
  const log = (await store.get<Record<string, boolean>>(NOTIFY_LOG_KEY)) ?? {};
  log[key] = true;
  const keys = Object.keys(log);
  if (keys.length > NOTIFY_LOG_MAX) {
    for (const k of keys.slice(0, keys.length - NOTIFY_LOG_MAX)) delete log[k];
  }
  await store.put(NOTIFY_LOG_KEY, log);
}

function faNum(n: number): string {
  try {
    return n.toLocaleString("fa-IR");
  } catch {
    return String(n);
  }
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 0 : 2 })}`;
}

async function fetchState(address: string): Promise<HlClearinghouseState | null> {
  try {
    const res = await fetch("https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "clearinghouseState", user: address }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as HlClearinghouseState | HlClearinghouseState[];
    return Array.isArray(data) ? (data[0] ?? null) : data;
  } catch (e) {
    console.log("[WhaleWatch] fetch failed:", e);
    return null;
  }
}

function parsePositions(state: HlClearinghouseState): SnapshotPos[] {
  const out: SnapshotPos[] = [];
  for (const ap of state?.assetPositions ?? []) {
    const p = ap?.position;
    if (!p?.coin) continue;
    const size = Math.abs(parseFloat(p.szi ?? "0"));
    const value = Math.abs(parseFloat(p.positionValue ?? "0"));
    if (!(size > 0) || value < MIN_NOTIONAL_USD) continue;
    out.push({
      coin: p.coin,
      size,
      side: p.side ?? (parseFloat(p.szi ?? "0") > 0 ? "long" : "short"),
      entryPx: parseFloat(p.entryPx ?? "0") || 0,
      value,
      pnl: parseFloat(p.unrealizedPnl ?? "0") || 0,
    });
  }
  return out;
}

/**
 * One whale-diff announcement (sent only once — notify-log dedupe).
 * key: `${whaleId}:${event}:${coin}:${roundedSize}:${dayBucket}`
 */
async function announce(
  cfg: { botToken: string; chatId: string },
  whale: WhaleWalletConfig,
  event: "open" | "close" | "increase" | "decrease",
  pos: SnapshotPos,
  extra?: { prevSize?: number; lastPnl?: number; lastEntry?: number }
): Promise<void> {
  const dayBucket = Math.floor(Date.now() / 86400_000);
  const key = `${whale.id}:${event}:${pos.coin}:${Math.round(pos.size * 100)}:${dayBucket}`;
  if (await wasNotified(key)) return;
  await markNotified(key);

  const dir = pos.side === "long" ? "🟢 لانگ" : "🔴 شورت";
  const lines: string[] = [];
  if (event === "close") {
    const pnl = extra?.lastPnl ?? 0;
    const pnlTxt =
      pnl > 0 ? `با سود ${fmtUsd(pnl)} ✅` : pnl < 0 ? `با زیان ${fmtUsd(Math.abs(pnl))} ❌` : "سر‌به‌سر";
    lines.push(
      `🔒 <b>پوزیشن نهنگ بسته شد</b>`,
      `🐋 ${whale.label}`,
      `${dir} <b>${pos.coin}</b> بسته شد — ${pnlTxt}`,
      `   📊 حجم موقعیت: ${fmtUsd(extra?.prevSize && extra.lastEntry ? extra.prevSize : pos.value)}`,
      `   💰 قیمت ورود: ${extra?.lastEntry ? extra.lastEntry.toLocaleString('en-US', { maximumFractionDigits: 6 }) : '—'}`
    );
  } else if (event === "open") {
    lines.push(
      `🆕 <b>نهنگ پوزیشن جدید باز کرد</b>`,
      `🐋 ${whale.label}`,
      `${dir} <b>${pos.coin}</b> — حجم ${fmtUsd(pos.value)}`,
      `   💰 قیمت ورود: ${pos.entryPx > 0 ? pos.entryPx.toLocaleString('en-US', { maximumFractionDigits: 6 }) : '—'}`
    );
  } else if (event === "increase") {
    lines.push(
      `⬆️ <b>نهنگ پوزیشن را تقویت کرد</b>`,
      `🐋 ${whale.label}`,
      `${dir} <b>${pos.coin}</b> از ${faNum(extra?.prevSize ?? 0)} به ${faNum(pos.size)} واحد رسید (ارزش ${fmtUsd(pos.value)})`
    );
  } else {
    lines.push(
      `⬇️ <b>نهنگ بخشی از پوزیشن را کم کرد</b>`,
      `🐋 ${whale.label}`,
      `${dir} <b>${pos.coin}</b> از ${faNum(extra?.prevSize ?? 0)} به ${faNum(pos.size)} واحد رسید (ارزش ${fmtUsd(pos.value)})`
    );
  }
  lines.push(`   🖥 Hyperliquid • ${new Date().toLocaleString("fa-IR")}`);
  await sendTelegram(cfg, lines.join("\n"));
  await sendPushToAll(
    event === "close" ? "🔒 نهنگ پوزیشن بست" : "🐋 حرکت نهنگ",
    `${whale.label}: ${pos.coin} ${pos.side === "long" ? "لانگ" : "شورت"} ${event}`,
    { kind: "whale", event, coin: pos.coin }
  );
}

export interface WhaleWatchSummary {
  checked: number;
  events: number;
  skipped?: string;
}

/**
 * Full whale-check cycle. Called from the fast scheduler every ~10 min.
 * Throttled internally to one run per 8 minutes.
 */
export async function runWhaleWatch(): Promise<WhaleWatchSummary> {
  try {
    const cfg = await store.get<{
      secret: string;
      botToken: string;
      chatId: string;
      whaleWallets?: WhaleWalletConfig[];
      whaleNotifications?: boolean;
    }>("config");
    if (!cfg || !cfg.botToken || !cfg.chatId) return { checked: 0, events: 0, skipped: "no-config" };
    if (cfg.whaleNotifications === false) return { checked: 0, events: 0, skipped: "whale-off" };
    const whales = (cfg.whaleWallets ?? []).slice(0, 40);
    if (whales.length === 0) return { checked: 0, events: 0, skipped: "no-whales" };

    const lastRun = (await store.get<number>("whaleWatchLastRun")) ?? 0;
    if (Date.now() - lastRun < 8 * 60_000) return { checked: 0, events: 0, skipped: "recent" };
    await store.put("whaleWatchLastRun", Date.now());

    const target = { botToken: cfg.botToken, chatId: cfg.chatId };
    const snapshots = await getSnapshots();
    let events = 0;

    for (const whale of whales) {
      try {
        const state = await fetchState(whale.address);
        if (!state) continue;
        const current = parsePositions(state);
        const prev = snapshots[whale.id];

        if (!prev || Date.now() - prev.at > SNAP_MAX_AGE_MS) {
          // first sight (or stale snapshot): just record, no announcement —
          // announcing positions the server never "saw" would be noise.
          snapshots[whale.id] = {
            positions: current,
            accountValue: parseFloat(state.marginSummary?.accountValue ?? "0") || 0,
            at: Date.now(),
          };
          continue;
        }

        for (const cur of current) {
          const old = prev.positions.find((p) => p.coin === cur.coin && p.side === cur.side);
          if (!old) {
            await announce(target, whale, "open", cur);
            events++;
          } else if (cur.size > old.size * 1.15) {
            await announce(target, whale, "increase", cur, { prevSize: old.size });
            events++;
          } else if (cur.size < old.size * 0.85) {
            await announce(target, whale, "decrease", cur, { prevSize: old.size });
            events++;
          }
        }
        for (const old of prev.positions) {
          const stillThere = current.find((p) => p.coin === old.coin && p.side === old.side);
          if (!stillThere) {
            await announce(target, whale, "close", old, {
              prevSize: old.size,
              lastPnl: old.pnl,
              lastEntry: old.entryPx,
            });
            events++;
          }
        }

        snapshots[whale.id] = {
          positions: current,
          accountValue: parseFloat(state.marginSummary?.accountValue ?? "0") || 0,
          at: Date.now(),
        };
      } catch (e) {
        console.log(`[WhaleWatch] whale ${whale.id} failed:`, e);
      }
    }

    await putSnapshots(snapshots);
    if (events > 0) {
      console.log(`[WhaleWatch] ${events} event(s) announced for ${whales.length} whale(s)`);
    }
    return { checked: whales.length, events };
  } catch (e) {
    console.log("[WhaleWatch] cycle failed:", e);
    return { checked: 0, events: 0, skipped: "error" };
  }
}

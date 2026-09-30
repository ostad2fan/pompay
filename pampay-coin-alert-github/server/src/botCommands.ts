// server/src/botCommands.ts
// Server-side Telegram bot command handler (v1.4.3).
//
// WHY: previously the commands (/status, /gainz, /scanner …) were ONLY
// processed by the app itself (polling getUpdates every 3s while open).
// With the app closed, commands sat unanswered — the user's #1 complaint.
//
// WHAT: the SERVER now polls getUpdates (4s, timeout=0) whenever a bot token
// + chat id are configured, and answers commands 24/7 from its own state:
//   /start /help /status /scanner /gainz /hook /indicators /meme /price
// Commands that need data living INSIDE the app (/balance /positions
// /signals /whale) are queued in the store and relayed to the app the next
// time it is open (GET /bot/pending → app answers → POST /bot/ack).
//
// The app detects the new server capability via /scan/status
// (serverBotCommands: true) and stops its own getUpdates polling then,
// so the two pollers never fight over updates.

import store from "./store";
import { sendTelegram } from "./telegram";
import { getNobitexUsdtToman } from "./nobitex";
import { getAlanchandUsdtToman } from "./alanchand";

interface BotConfig {
  secret: string;
  botToken: string;
  chatId: string;
  /** Optional fast-cycle flags synced from the app (scanEngine's ScanConfig). */
  scannerEnabled?: boolean;
  memeEnabled?: boolean;
  preListingEnabled?: boolean;
}

export interface PendingBotCommand {
  id: number;
  command: string;
  chatId: string;
  receivedAt: number;
}

const PENDING_KEY = "pendingBotCommands";
const OFFSET_KEY = "botCommandOffset";
const PENDING_TTL_MS = 48 * 3600_000; // drop unanswered commands after 48h
const PENDING_MAX = 50;

let poller: ReturnType<typeof setInterval> | null = null;
let polling = false;

async function getConfig(): Promise<BotConfig | null> {
  const cfg = await store.get<BotConfig>("config");
  if (cfg && cfg.botToken && cfg.chatId) return cfg;
  return null;
}

async function getPending(): Promise<PendingBotCommand[]> {
  const list = (await store.get<PendingBotCommand[]>(PENDING_KEY)) ?? [];
  const now = Date.now();
  const fresh = list.filter((c) => now - c.receivedAt < PENDING_TTL_MS);
  return fresh.length === list.length ? list : (await putPending(fresh), fresh);
}

async function putPending(list: PendingBotCommand[]): Promise<void> {
  await store.put(PENDING_KEY, list.slice(-PENDING_MAX));
}

/** Commands the APP must answer (data lives in AsyncStorage on the phone). */
const APP_RELAY_COMMANDS = new Set(["/balance", "/positions", "/signals", "/whale"]);

// ---------------------------------------------------------------------------
// Server-side answer builders (mirror the app's Persian texts)
// ---------------------------------------------------------------------------

function faDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString("fa-IR");
  } catch {
    return new Date(ms).toISOString();
  }
}

async function helpText(): Promise<string> {
  return [
    "❓ <b>راهنمای ربات PomPay</b>",
    "",
    "این دستورات <b>حتی وقتی برنامه بسته است</b> پاسخ می‌گیرند (پاسخ از سرور):",
    "/start - 🚀 منوی اصلی",
    "/status - 📊 وضعیت اسکن سرور و اعلان‌ها",
    "/scanner - 🔍 سیگنال‌های پامپ/دامپ آخرین اسکن",
    "/gainz - 📊 سیگنال‌های GainzAlgo",
    "/indicators - 🧩 سیگنال اندیکاتورهای دستی",
    "/hook - 🪝 سیگنال‌های هوک ریورسال",
    "/meme - 💀 سیگنال‌های میم‌کوین",
    "/price - 💵 قیمت لحظه‌ای تتر (تومان)",
    "",
    "این دستورات به داده داخل گوشی نیاز دارند؛ اگر برنامه بسته باشد،",
    "به‌محض باز شدن برنامه پاسخ خود را دریافت می‌کنید:",
    "/balance - 💰 موجودی صرافی‌ها",
    "/positions - 📈 پوزیشن‌های باز",
    "/signals - 🎯 سیگنال‌های AI",
    "/whale - 🐋 نهنگ‌های تحت ردیابی",
    "",
    `🏦 سرور: متصل • آخرین پاسخ ${faDate(Date.now())}`,
  ].join("\n");
}

async function statusText(): Promise<string> {
  const cfg = (await store.get<BotConfig>("config")) ?? ({} as Partial<BotConfig>);
  const [lastScanAt, lastFastScanAt, pump, meme, pre, gainz, hook, custom] = await Promise.all([
    store.get<number>("lastScanAt"),
    store.get<number>("lastFastScanAt"),
    store.get<unknown[]>("pumpDumpSignals"),
    store.get<unknown[]>("memeSignals"),
    store.get<unknown[]>("preListingSignals"),
    store.get<unknown[]>("gainzSignals"),
    store.get<unknown[]>("hookSignals"),
    store.get<unknown[]>("customSignals"),
  ]);
  const pending = await getPending();
  return [
    "📊 <b>وضعیت PomPay (سرور)</b>",
    "",
    `🔍 اسکن سریع (پامپ/دامپ/میم): ${lastFastScanAt ? faDate(lastFastScanAt) : "هنوز اجرا نشده"}`,
    `📈 اسکن کندلی (Gainz/هوک/اندیکاتور): ${lastScanAt ? faDate(lastScanAt) : "هنوز اجرا نشده"}`,
    "",
    `🟢 پامپ/دامپ ذخیره‌شده: ${Array.isArray(pump) ? pump.length : 0}`,
    `💀 میم‌کوین: ${Array.isArray(meme) ? meme.length : 0}`,
    `🚀 قبل از لیست: ${Array.isArray(pre) ? pre.length : 0}`,
    `📊 GainzAlgo: ${Array.isArray(gainz) ? gainz.length : 0}`,
    `🪝 هوک ریورسال: ${Array.isArray(hook) ? hook.length : 0}`,
    `🧩 اندیکاتورهای دستی: ${Array.isArray(custom) ? custom.length : 0}`,
    "",
    `⚙️ اسکنر: ${cfg.scannerEnabled !== false ? "✅" : "❌"} | میم: ${cfg.memeEnabled !== false ? "✅" : "❌"} | قبل‌لیست: ${cfg.preListingEnabled !== false ? "✅" : "❌"}`,
    `⏳ دستورات در انتظار برنامه: ${pending.length}`,
    "",
    "📡 سرور حتی با برنامه بسته هر ۱۰ دقیقه اسکن می‌کند و اعلان‌ها را همین‌جا می‌فرستد.",
  ].join("\n");
}

interface MiniSignal {
  displayName?: string;
  symbol?: string;
  signalType?: string;
  action?: string;
  price?: number;
  currentPrice?: number;
  timeframe?: string;
  rsi?: number;
}

async function scannerText(): Promise<string> {
  const signals = (await store.get<MiniSignal[]>("pumpDumpSignals")) ?? [];
  if (!Array.isArray(signals) || signals.length === 0) {
    return "🔍 اسکنر فعال است اما در آخرین اسکن سیگنالی شناسایی نشد. سرور هر ۱۰ دقیقه خودکار بررسی می‌کند.";
  }
  const lines = [`🔍 <b>آخرین سیگنال‌های پامپ/دامپ (${signals.length})</b>\n`];
  for (const s of signals.slice(0, 40)) {
    const icon = s.signalType === "dump" ? "🔴" : "🟢";
    const type = s.signalType === "dump" ? "دامپ" : "پامپ";
    lines.push(
      `${icon} <b>${s.displayName ?? s.symbol ?? "?"}</b> - ${type}`,
      `   قیمت: $${Number(s.currentPrice ?? 0).toFixed(4)}`,
      ""
    );
  }
  return lines.join("\n");
}

async function gainzText(): Promise<string> {
  const signals = (await store.get<MiniSignal[]>("gainzSignals")) ?? [];
  if (!Array.isArray(signals) || signals.length === 0) {
    return "📊 هنوز سیگنال GainzAlgo روی سرور ثبت نشده است. اسکن سرور حتی با برنامه بسته ادامه دارد.";
  }
  const lines = [`📊 <b>GainzAlgo — آخرین سیگنال‌های سرور (${signals.length})</b>\n`];
  for (const s of signals.slice(0, 60)) {
    const icon = s.action === "buy" ? "🟢" : "🔴";
    lines.push(
      `${icon} <b>${s.displayName ?? s.symbol ?? "?"}</b> — ${s.action === "buy" ? "BUY" : "SELL"}`,
      `   قیمت: $${Number(s.price ?? 0).toFixed(4)}${s.rsi ? ` | RSI: ${s.rsi}` : ""}${s.timeframe ? ` | ${s.timeframe}` : ""}`,
      ""
    );
  }
  return lines.join("\n");
}

async function indicatorsText(): Promise<string> {
  const signals = (await store.get<MiniSignal[]>("customSignals")) ?? [];
  const lines = ["🧩 <b>اندیکاتورهای دستی — آخرین سیگنال‌های سرور</b>\n"];
  if (!Array.isArray(signals) || signals.length === 0) {
    lines.push("📭 هنوز سیگنالی از اندیکاتورهای شما ثبت نشده است.");
  } else {
    for (const s of signals.slice(0, 60)) {
      const icon = s.action === "buy" ? "🟢" : "🔴";
      lines.push(`${icon} <b>${s.displayName ?? s.symbol ?? "?"}</b> — ${s.action === "buy" ? "BUY" : "SELL"}`);
      if (s.price) lines.push(`   قیمت: $${Number(s.price).toFixed(4)}${s.timeframe ? ` | ${s.timeframe}` : ""}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

async function hookText(): Promise<string> {
  const signals = (await store.get<MiniSignal[]>("hookSignals")) ?? [];
  if (!Array.isArray(signals) || signals.length === 0) {
    return "🪝 هنوز سیگنال هوک ریورسال روی سرور ثبت نشده است.";
  }
  const lines = [`🪝 <b>هوک ریورسال — آخرین سیگنال‌های سرور (${signals.length})</b>\n`];
  for (const s of signals.slice(0, 60)) {
    const icon = s.action === "buy" ? "🟢" : "🔴";
    lines.push(`${icon} <b>${s.displayName ?? s.symbol ?? "?"}</b> — ${s.action === "buy" ? "هوک صعودی" : "هوک نزولی"}`);
    if (s.price) lines.push(`   قیمت: $${Number(s.price).toFixed(4)}${s.timeframe ? ` | ${s.timeframe}` : ""}`);
    lines.push("");
  }
  return lines.join("\n");
}

async function memeText(): Promise<string> {
  const signals = (await store.get<Array<Record<string, unknown>>>("memeSignals")) ?? [];
  if (!Array.isArray(signals) || signals.length === 0) {
    return "💀 در آخرین اسکن سرور، سیگنال میم‌کوینی ثبت نشده است.";
  }
  const lines = [`💀 <b>میم‌کوین — آخرین سیگنال‌های سرور (${signals.length})</b>\n`];
  for (const s of signals.slice(0, 30)) {
    const name = String(s.name ?? s.symbol ?? s.displayName ?? "?");
    const conf = s.confidence != null ? ` | اطمینان: ${s.confidence}%` : "";
    lines.push(`• <b>${name}</b>${conf}`, "");
  }
  return lines.join("\n");
}

async function priceText(): Promise<string> {
  const lines = ["💵 <b>قیمت تتر</b>\n"];
  try {
    const nobitex = await getNobitexUsdtToman();
    if (nobitex?.usdtToToman) {
      lines.push(` Nobitex: ${nobitex.usdtToToman.toLocaleString("fa-IR")} تومان`);
    }
  } catch {}
  try {
    const alanchand = await getAlanchandUsdtToman();
    if (alanchand?.usdtToToman) {
      lines.push(` Alan.Chand: ${alanchand.usdtToToman.toLocaleString("fa-IR")} تومان`);
    }
  } catch {}
  if (lines.length <= 1) lines.push("⚠️ دریافت قیمت ناموفق بود — کمی بعد دوباره امتحان کنید.");
  return lines.join("\n");
}

async function queueText(command: string): Promise<string> {
  return [
    `⏳ دستور ${command} دریافت شد.`,
    "",
    "این دستور به داده‌های داخل خود برنامه نیاز دارد. اگر برنامه باز باشد تا چند ثانیه دیگر پاسخ می‌گیرید؛",
    "اگر بسته باشد، به‌محض باز کردن برنامه پاسخ ارسال می‌شود (تا ۴۸ ساعت نگه داشته می‌شود).",
    "",
    "💡 راهنما: /help",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Command dispatch
// ---------------------------------------------------------------------------

async function handleCommand(
  command: string,
  cfg: BotConfig,
  chatId: string
): Promise<void> {
  const target = { botToken: cfg.botToken, chatId };
  switch (command) {
    case "/start":
    case "/help":
      await sendTelegram(target, await helpText());
      return;
    case "/status":
      await sendTelegram(target, await statusText());
      return;
    case "/scanner":
      await sendTelegram(target, await scannerText());
      return;
    case "/gainz":
      await sendTelegram(target, await gainzText());
      return;
    case "/indicators":
      await sendTelegram(target, await indicatorsText());
      return;
    case "/hook":
      await sendTelegram(target, await hookText());
      return;
    case "/meme":
      await sendTelegram(target, await memeText());
      return;
    case "/price":
      await sendTelegram(target, await priceText());
      return;
    default:
      if (APP_RELAY_COMMANDS.has(command)) {
        const pending = await getPending();
        pending.push({
          id: Date.now() + Math.floor(Math.random() * 1000),
          command,
          chatId,
          receivedAt: Date.now(),
        });
        await putPending(pending);
        await sendTelegram(target, await queueText(command));
        return;
      }
      await sendTelegram(
        target,
        "❓ دستور نامعتبر است.\n\n/help را بزنید برای مشاهده لیست دستورات."
      );
  }
}

// ---------------------------------------------------------------------------
// getUpdates poller
// ---------------------------------------------------------------------------

async function pollOnce(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const cfg = await getConfig();
    if (!cfg) return; // nothing configured — sleep until the app syncs its config

    const offset = (await store.get<number>(OFFSET_KEY)) ?? 0;
    const url =
      `https://api.telegram.org/bot${cfg.botToken}/getUpdates` +
      `?offset=${offset + 1}&limit=20&timeout=0`;
    const res = await fetch(url);
    const data = (await res.json()) as {
      ok?: boolean;
      result?: Array<{
        update_id: number;
        message?: { chat?: { id?: number }; text?: string };
      }>;
    };
    if (!data.ok || !Array.isArray(data.result) || data.result.length === 0) return;

    let maxOffset = offset;
    for (const update of data.result) {
      if (update.update_id > maxOffset) maxOffset = update.update_id;
      const msg = update.message;
      if (!msg?.text) continue;
      const chatId = String(msg.chat?.id ?? cfg.chatId);
      // Only answer the configured owner chat — other chats are ignored.
      if (chatId !== String(cfg.chatId)) continue;
      const text = msg.text.trim();
      if (!text.startsWith("/")) continue;
      const command = text.split("@")[0].split(" ")[0].toLowerCase();
      try {
        await handleCommand(command, cfg, chatId);
      } catch (e) {
        console.log(`[BotCommands] handler error for ${command}:`, e);
      }
    }
    if (maxOffset > offset) {
      await store.put(OFFSET_KEY, maxOffset);
    }
  } catch (e) {
    console.log("[BotCommands] poll error:", e);
  } finally {
    polling = false;
  }
}

/** Starts the 24/7 command poller (called once from index.ts at boot). */
export function startBotCommandPoller(): void {
  if (poller) return;
  console.log("[BotCommands] server-side command poller starting (4s interval)");
  poller = setInterval(() => void pollOnce(), 4_000);
  // Small delay so the boot scan doesn't collide with the first poll.
  setTimeout(() => void pollOnce(), 2_000);
}

// ---------------------------------------------------------------------------
// Relay API used by the app (GET /bot/pending + POST /bot/ack)
// ---------------------------------------------------------------------------

export async function getPendingForApp(secret: string): Promise<PendingBotCommand[]> {
  const cfg = await getConfig();
  if (!cfg || !secret || cfg.secret !== secret) return [];
  return getPending();
}

export async function ackPendingForApp(secret: string, ids: number[]): Promise<number> {
  const cfg = await getConfig();
  if (!cfg || !secret || cfg.secret !== secret || !Array.isArray(ids)) return 0;
  const pending = await getPending();
  const idSet = new Set(ids.map(Number));
  const remaining = pending.filter((c) => !idSet.has(c.id));
  await putPending(remaining);
  return pending.length - remaining.length;
}

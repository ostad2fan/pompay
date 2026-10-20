// server/src/heartbeat.ts — v1.5.8 (R4)
//
// «هنوز هیچ اعلانی در حالت بسته بودن برنامه از بخش‌های اندیکاتور و بک‌تست
// نمی‌آید و انگار اعلان اسکنرها هم قطع شده» — این پیام روزانه، صبح‌ها به
// وقت تهران، یک‌بار به چت تلگرامِ پیکربندی‌شده می‌رود تا دو چیز قابل تشخیص
// شود:
//   1. اگر پیام «رفتی به حالت بسته بودن برنامه» — یعنی مسیر اعلان سالم است؛
//      پس سکوت یعنی یا رویدادی (سیگنال/حرکت نهنگ) رخ نداده یا بخشی در
//      تنظیمات برنامه خاموش است — وضعیت تک‌تک بخش‌ها داخل همین پیام است.
//   2. اگر پیام نیامد — مسیر تلگرام (توکن/چت‌آیدی روی سرور) مشکل دارد؛ دکمه
//      «بررسی سلامت اعلان‌های ۲۴/۷» در تنظیمات دقیق علت را نشان می‌دهد.
//
// کی فرستاده می‌شود؟ هر روز، بعد از ساعت ۹ صبح تهران، یک‌بار (اولین fastTick
// بعد از آن). اگر تلگرام پیکربندی نشده باشد چیزی فرستاده نمی‌شود (که خودش
// عیب است و در /scan/status دیده می‌شود).

import store from "./store";
import { sendTelegram, getLastTelegramError } from "./telegram";

/** کلید روز تهران (UTC+3:30) — YY-MM-DD. */
function tehranDayKey(now = new Date()): string {
  const t = new Date(now.getTime() + 210 * 60_000); // +3:30
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** ساعت تهران (UTC+3:30). */
function tehranHour(now = new Date()): number {
  const t = new Date(now.getTime() + 210 * 60_000);
  return t.getUTCHours();
}

function minutesAgo(ms: number | null | undefined): string {
  if (!ms) return "—";
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (m < 60) return `${m} دقیقه پیش`;
  const h = Math.floor(m / 60);
  return `${h} ساعت و ${m % 60} دقیقه پیش`;
}

interface HeartbeatConfig {
  secret?: string;
  botToken?: string;
  chatId?: string;
  gainzAlgoEnabled?: boolean;
  gainzTimeframes?: string[];
  hookEnabled?: boolean;
  hookTimeframes?: string[];
  scannerEnabled?: boolean;
  memeEnabled?: boolean;
  preListingEnabled?: boolean;
  whaleNotifications?: boolean;
  whaleWallets?: { address: string; label?: string }[];
  indicators?: { id: string; receiveSignals?: boolean; timeframe?: string }[];
}

/** یک‌بار در روز (ساعت ۹ به بعد به وقت تهران) پیام سلامت می‌فرستد. */
export async function runDailyHeartbeat(): Promise<void> {
  try {
    const cfg = (await store.get<HeartbeatConfig>("config")) ?? {};
    if (!cfg.botToken || !cfg.chatId) return; // مسیر تلگرام اصلا تنظیم نیست

    // فقط بعد از ساعت ۹ صبح تهران + یک‌بار در روز
    if (tehranHour() < 9) return;
    const today = tehranDayKey();
    const lastDate = (await store.get<string>("heartbeatDate")) ?? "";
    const lastAt = (await store.get<number>("heartbeatAt")) ?? 0;
    if (lastDate === today) return;
    if (Date.now() - lastAt < 6 * 3600_000) return; // ضدتکرار بعد از ری‌استارت

    const indicators = cfg.indicators ?? [];
    const receive = indicators.filter((i) => i.receiveSignals);
    const whales = cfg.whaleWallets ?? [];

    // وضعیت ربات بک‌تست (موتور ۲۴/۷)
    const autoDoc = await store.get<{ cfg?: { enabled?: boolean; mode?: string }; whaleSnapshot?: unknown[] }>("autoTradeConfig");
    const autoState = await store.get<{ lastCycleAt?: number | null }>("autoTradeState");
    const botOn = !!autoDoc?.cfg?.enabled;
    const botMode = autoDoc?.cfg?.mode === "real" ? "واقعی" : "دمو";

    const lastTelegramError = await getLastTelegramError();
    const lastTelegramSuccessAt = (await store.get<number>("lastTelegramSuccessAt")) ?? null;
    const customErrors = (await store.get<Record<string, string>>("customErrors")) ?? {};
    const errorCount = Object.keys(customErrors).length;

    const on = (b: boolean | undefined, note?: string): string =>
      b !== false ? `✅ فعال${note ? ` (${note})` : ""}` : `⛔️ خاموش (از تنظیمات برنامه)`;

    const lines: string[] = [
      "💓 <b>سلامت اعلان‌های ۲۴/۷ — PampDumpCoins</b>",
      "سرور حتی وقتی برنامه بسته است، پایش می‌کند. وضعیت امروزِ بخش‌ها:",
      `🚀 پامپ/دامپ: ${on(cfg.scannerEnabled)}`,
      `🎯 شورت میم‌کوین: ${on(cfg.memeEnabled)}`,
      `📌 پیش‌لیستینگ: ${on(cfg.preListingEnabled)}`,
      `📈 GainzAlgo: ${on(cfg.gainzAlgoEnabled, (cfg.gainzTimeframes ?? []).join("/"))}`,
      `🪝 هوک ریورسال: ${on(cfg.hookEnabled, (cfg.hookTimeframes ?? []).join("/"))}`,
      `🧩 اندیکاتورهای دستی: ${receive.length > 0 ? `✅ ${receive.length} اندیکاتور فعال (${receive.map((i) => i.timeframe).join("/")})` : "⛔️ هیچ‌کدام سیگنال نمی‌فرستند (بخش اندیکاتورها → دریافت سیگنال روشن باشد)"}`,
      `🐋 نهنگ‌ها: ${whales.length > 0 ? `✅ ${whales.length} نهنگ — ${on(cfg.whaleNotifications)}` : "⛔️ نهنگی ثبت نشده"}`,
      `🤖 ربات بک‌تست (سرور): ${botOn ? `✅ روشن (${botMode}) — آخرین چرخه ${minutesAgo(autoState?.lastCycleAt)}` : "⛔️ خاموش (در تب بک‌تست روشن کنید)"}`,
      `✉️ آخرین ارسال موفق تلگرام: ${minutesAgo(lastTelegramSuccessAt)}`,
    ];
    if (lastTelegramError) {
      lines.push(`⚠️ آخرین خطای تلگرام: ${lastTelegramError.error ?? "نامشخص"}`);
    }
    if (errorCount > 0) {
      lines.push(`⚠️ ${errorCount} اندیکاتور روی سرور خطا می‌دهند — بخش اندیکاتورها → «وضعیت سرور» را ببینید.`);
    }
    lines.push("");
    lines.push("این پیام هر روز صبح حدود ساعت ۹ یک‌بار می‌آید تا مطمئن شوید مسیر اعلان سالم است. سیگنال‌ها و حرکت نهنگ‌ها همان لحظه‌ی رخداد جداگانه اعلام می‌شوند.");

    const sent = await sendTelegram({ botToken: cfg.botToken, chatId: cfg.chatId }, lines.join("\n"));
    // حتی اگر ارسال شکست خورد تاریخ را می‌نویسیم تا ساعت ۹ فردا دوباره تلاش
    // نشود (خطا در /scan/status و بررسی سلامت دیده می‌شود).
    await store.put("heartbeatDate", today);
    if (sent) {
      await store.put("heartbeatAt", Date.now());
      console.log("[Heartbeat] daily health message sent");
    } else {
      console.log("[Heartbeat] daily health message FAILED to send");
    }
  } catch (e) {
    console.log("[Heartbeat] failed (non-fatal):", e);
  }
}

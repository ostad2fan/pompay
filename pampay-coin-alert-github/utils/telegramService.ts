import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import {
  GainzAlgoSignal,
  GAINZ_TF_LABEL,
  GAINZ_TF_ORDER,
  scanGainzAlgoDailySignals,
} from './gainzAlgoService';
import type { GainzTimeframe } from '@/types/crypto';
import { getUserIndicators, getStoredCustomSignals } from './customIndicatorsService';
import {
  HookReversalSignal,
  HOOK_TF_LABEL,
  getStoredHookSignals,
} from './hookReversalService';
import { fetchServerSignals, serverSupportsBotCommands, fetchPendingBotCommands, ackBotCommands } from './scanServerApi';

const SETTINGS_KEY = '@crypto_scanner_settings';
const SIGNALS_KEY = '@crypto_scanner_signals';
const DEMO_KEY = '@trade_ai_demo';
const SIGNALS_HISTORY_KEY = '@trade_ai_signals';
const EXCHANGE_CONFIGS_KEY = '@real_trade_exchange_configs';
const AUTO_TRADE_CONFIG_KEY = '@real_trade_auto_config';
const AUTO_TRADE_LOG_KEY = '@real_trade_auto_log';
const TRACKED_WALLETS_KEY = '@tracked_whale_wallets';
const TELEGRAM_OFFSET_KEY = '@telegram_last_update_id';

interface TelegramSettings {
  telegramBotToken: string;
  telegramChatId: string;
  telegramEnabled: boolean;
}

let pollingInterval: ReturnType<typeof setInterval> | null = null;
let isPolling = false;

async function getTelegramSettings(): Promise<TelegramSettings | null> {
  try {
    const stored = await AsyncStorage.getItem(SETTINGS_KEY);
    if (!stored) return null;
    const settings = JSON.parse(stored);
    if (!settings.telegramEnabled || !settings.telegramBotToken || !settings.telegramChatId) return null;
    return {
      telegramBotToken: settings.telegramBotToken,
      telegramChatId: settings.telegramChatId,
      telegramEnabled: settings.telegramEnabled,
    };
  } catch {
    return null;
  }
}

const TELEGRAM_MAX_LEN = 3800;

// ---------------------------------------------------------------------------
// Candle timing helpers — the signals must state WHEN the candle closed
// (Iran time, UTC+3:30) so the user can find the exact candle on the chart.
// ---------------------------------------------------------------------------

/** Candle duration per timeframe (ms). */
const CANDLE_TF_MS: Record<string, number> = {
  '15m': 15 * 60_000,
  '30m': 30 * 60_000,
  '1h': 60 * 60_000,
  '4h': 4 * 60 * 60_000,
  '1d': 24 * 60 * 60_000,
};

/** Tehran clock = UTC+3:30 year-round (Iran abolished DST in 2022). */
function tehranClock(ms: number): string {
  const d = new Date(ms + 3.5 * 3600_000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function faDateFa(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString('fa-IR');
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/**
 * e.g. «سیگنال در کلوز کندل ۱ ساعته — ساعت 15:00 به وقت ایران (UTC+3:30)
 *       • کندل باز شده در ساعت 14:00 • ۱۴۰۴/۰۷/۰۳»
 */
function candleTimeLine(tf: string, candleOpenTime: number, live = false, tfLabelOverride?: string): string {
  const tfMs = CANDLE_TF_MS[tf] ?? CANDLE_TF_MS['1d'];
  const label = tfLabelOverride ?? GAINZ_TF_LABEL[tf as GainzTimeframe] ?? tf;
  const closeMs = candleOpenTime + tfMs;
  const tz = 'وقت ایران (UTC+3:30)';
  if (live) {
    return `   🕐 کندل ${label} هنوز در حال ساخت است — باز شده در ساعت ${tehranClock(candleOpenTime)} و کلوز بعدی آن ساعت ${tehranClock(closeMs)} به ${tz}`;
  }
  return `   🕐 سیگنال در کلوز کندل ${label} — ساعت ${tehranClock(closeMs)} به ${tz}` +
    ` • کندل باز شده در ساعت ${tehranClock(candleOpenTime)} • ${faDateFa(candleOpenTime)}`;
}

/**
 * Splits a long text into Telegram-safe chunks (<= 4096 chars per message),
 * breaking on line boundaries so lists of MANY signals never get truncated.
 */
function splitTelegramText(text: string, limit: number = TELEGRAM_MAX_LEN): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let current = '';
  for (const line of text.split('\n')) {
    // A single overlong line (rare) is hard-split.
    if (line.length > limit) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < line.length; i += limit) {
        chunks.push(line.slice(i, i + limit));
      }
      continue;
    }
    if ((current + '\n' + line).length > limit) {
      chunks.push(current);
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendTelegramMessage(text: string, parseMode: string = 'HTML'): Promise<boolean> {
  try {
    const tg = await getTelegramSettings();
    if (!tg) return false;

    let allOk = true;
    const chunks = splitTelegramText(text);
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await sleep(400); // stay under the bot rate limit
      const res = await fetch(`https://api.telegram.org/bot${tg.telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: tg.telegramChatId,
          text: chunks[i],
          parse_mode: parseMode,
        }),
      });

      const data = await res.json();
      if (data.ok) {
        console.log(`[Telegram] Message sent successfully (chunk ${i + 1}/${chunks.length})`);
      } else {
        console.log('[Telegram] Send error', data.description);
        allOk = false;
      }
    }
    return allOk;
  } catch (e) {
    console.log('[Telegram] Error sending message', e);
    return false;
  }
}

async function sendMessageDirect(token: string, chatId: string, text: string, parseMode: string = 'HTML'): Promise<boolean> {
  try {
    let allOk = true;
    const chunks = splitTelegramText(text);
    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) await sleep(400); // stay under the bot rate limit
      const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunks[i],
          parse_mode: parseMode,
        }),
      });
      const data = await res.json();
      if (data.ok !== true) {
        allOk = false;
      }
    }
    return allOk;
  } catch (e) {
    console.log('[Telegram] Direct send error', e);
    return false;
  }
}

async function getLastOffset(): Promise<number> {
  try {
    const stored = await AsyncStorage.getItem(TELEGRAM_OFFSET_KEY);
    if (stored) return parseInt(stored, 10);
  } catch {}
  return 0;
}

async function saveLastOffset(offset: number): Promise<void> {
  try {
    await AsyncStorage.setItem(TELEGRAM_OFFSET_KEY, String(offset));
  } catch {}
}

async function handleCommand(command: string, token: string, chatId: string): Promise<void> {
  console.log(`[Telegram] Processing command ${command}`);

  switch (command) {
    case '/start':
      await handleStartCommand(token, chatId);
      break;
    case '/status':
      await handleStatusCommand(token, chatId);
      break;
    case '/signals':
      await handleSignalsCommand(token, chatId);
      break;
    case '/positions':
      await handlePositionsCommand(token, chatId);
      break;
    case '/balance':
      await handleBalanceCommand(token, chatId);
      break;
    case '/scanner':
      await handleScannerCommand(token, chatId);
      break;
    case '/meme':
      await handleMemeCommand(token, chatId);
      break;
    case '/whale':
      await handleWhaleCommand(token, chatId);
      break;
    case '/gainz':
      await handleGainzCommand(token, chatId);
      break;
    case '/indicators':
      await handleIndicatorsCommand(token, chatId);
      break;
    case '/hook':
      await handleHookCommand(token, chatId);
      break;
    case '/help':
      await handleHelpCommand(token, chatId);
      break;
    default:
      await sendMessageDirect(token, chatId,
        '❓ دستور نامعتبر.\n\n/help را بزنید برای مشاهده لیست دستورات.'
      );
      break;
  }
}

async function handleStartCommand(token: string, chatId: string): Promise<void> {
  const text = [
    '🤖 <b>Trade Master Bot فعال شد!</b>',
    '',
    '📋 <b>منوی دستورات</b>',
    '/status - 📊 وضعیت کلی حساب و ربات',
    '/signals - 🎯 آخرین سیگنال‌های AI',
    '/positions - 📈 پوزیشن‌های باز',
    '/balance - 💰 موجودی حساب',
    '/scanner - 🔍 وضعیت اسکنر سیگنال',
    '/meme - 💀 اسکنر میم‌کوین',
    '/whale - 🐋 ردیابی نهنگ‌ها',
    '/gainz - 📊 سیگنال اندیکاتور GainzAlgo (روزانه)',
    '/indicators - 🧩 اندیکاتورهای دستی شما',
    '/hook - 🪝 سیگنال‌های هوک ریورسال (۴ ساعته/روزانه)',
    '/help - ❓ راهنمای کامل',
    '',
    '🔔 <b>اعلان‌های فعال</b>',
    '• سیگنال‌های اسکنر (پامپ/دامپ)',
    '• سیگنال‌های AI و Confluence',
    '• باز/بسته شدن پوزیشن‌ها (دمو و واقعی)',
    '• اسکنر شورت میم‌کوین',
    '• اسکنر قبل لیست شدن',
    '• فعالیت نهنگ‌ها',
    '• 📊 سیگنال‌های خرید/فروش اندیکاتور GainzAlgo (۱ ساعته، ۴ ساعته یا روزانه — اسکن سرور حتی با برنامه بسته)',
    '• 🧩 سیگنال‌های اندیکاتورهای دستی شما',
    '',
    '⚡️ تمام اعلان‌ها به صورت خودکار ارسال می‌شوند.',
    '📱 مدیریت کامل تنظیمات از داخل برنامه اصلی انجام می‌شود.',
  ].join('\n');

  await sendMessageDirect(token, chatId, text);
}

async function handleStatusCommand(token: string, chatId: string): Promise<void> {
  try {
    const settingsStr = await AsyncStorage.getItem(SETTINGS_KEY);
    const settingsData = settingsStr ? JSON.parse(settingsStr) : {};

    const signalsStr = await AsyncStorage.getItem(SIGNALS_KEY);
    const signals = signalsStr ? JSON.parse(signalsStr) : [];

    const demoStr = await AsyncStorage.getItem(DEMO_KEY);
    const demo = demoStr ? JSON.parse(demoStr) : null;

    const autoConfigStr = await AsyncStorage.getItem(AUTO_TRADE_CONFIG_KEY);
    const autoConfig = autoConfigStr ? JSON.parse(autoConfigStr) : null;

    const exchangeStr = await AsyncStorage.getItem(EXCHANGE_CONFIGS_KEY);
    const exchanges = exchangeStr ? JSON.parse(exchangeStr) : [];

    const aiSignalsStr = await AsyncStorage.getItem(SIGNALS_HISTORY_KEY);
    const aiSignals = aiSignalsStr ? JSON.parse(aiSignalsStr) : [];

    const pumpCount = signals.filter((s: { signalType: string }) => s.signalType === 'pump').length;
    const dumpCount = signals.filter((s: { signalType: string }) => s.signalType === 'dump').length;

    const lines = [
      '📊 <b>وضعیت کلی Trade Master</b>',
      '',
      '🔍 <b>اسکنر سیگنال</b>',
      `   سیگنال‌های فعال: ${signals.length} (🟢 ${pumpCount} پامپ | 🔴 ${dumpCount} دامپ)`,
      `   صرافی پیش‌فرض: ${settingsData.exchange || 'binance'}`,
      `   حالت سیگنال: ${settingsData.useVolumeOnlySignals ? 'فقط حجمی' : 'تحلیل Confluence'}`,
      '',
      '🤖 <b>ترید AI</b>',
      `   سیگنال‌های AI: ${aiSignals.length}`,
    ];

    if (demo) {
      lines.push(
        `   موجودی دمو: $${(demo.balance || 0).toFixed(2)}`,
        `   پوزیشن‌های دمو باز: ${(demo.positions || []).length}`,
        `   تعداد معامله دمو: ${(demo.tradeHistory || []).length}`,
      );
    }

    if (autoConfig) {
      lines.push(
        '',
        '⚙️ <b>ربات اتوماتیک</b>',
        `   وضعیت: ${autoConfig.enabled ? '✅ فعال' : '❌ غیرفعال'}`,
        `   حجم ورود: $${autoConfig.entryAmount || 50}`,
        `   حداقل اطمینان: ${autoConfig.minConfidence || 78}%`,
        `   حداکثر پوزیشن باز: ${autoConfig.maxOpenPositions || 3}`,
      );
    }

    lines.push(
      '',
      '🏦 <b>صرافی‌های متصل</b>',
      exchanges.length > 0
        ? exchanges.map((ex: { exchangeId: string; enabled: boolean }) =>
            `   • ${ex.exchangeId} ${ex.enabled ? '✅' : '❌'}`
          ).join('\n')
        : '   هیچ صرافی متصل نیست',
      '',
      '🔔 <b>اعلان‌ها</b>',
      `   اسکنر: ${settingsData.scannerNotifications !== false ? '✅' : '❌'}`,
      `   نهنگ: ${settingsData.whaleNotifications !== false ? '✅' : '❌'}`,
      `   شورت میم: ${settingsData.memeShortNotifications !== false ? '✅' : '❌'}`,
      `   قبل لیست: ${settingsData.preListingNotifications !== false ? '✅' : '❌'}`,
      `   AI ترید: ${settingsData.tradeAiNotifications !== false ? '✅' : '❌'}`,
      '',
      `⏱ آخرین بروزرسانی: ${new Date().toLocaleString('fa-IR')}`,
    );

    await sendMessageDirect(token, chatId, lines.join('\n'));
  } catch (e) {
    console.log('[Telegram] Status command error', e);
    await sendMessageDirect(token, chatId, '❌ خطا در دریافت وضعیت. لطفاً دوباره تلاش کنید.');
  }
}

async function handleSignalsCommand(token: string, chatId: string): Promise<void> {
  try {
    const aiSignalsStr = await AsyncStorage.getItem(SIGNALS_HISTORY_KEY);
    const aiSignals = aiSignalsStr ? JSON.parse(aiSignalsStr) : [];

    if (aiSignals.length === 0) {
      await sendMessageDirect(token, chatId, '📭 هیچ سیگنال AI فعالی وجود ندارد.\n\nاز بخش «ترید با AI» در برنامه تحلیل انجام دهید.');
      return;
    }

    const lines = ['🎯 <b>آخرین سیگنال‌های AI</b>\n'];

    // Show ALL AI signals — the message is auto-split into chunks by the sender.
    for (const sig of aiSignals) {
      const icon = sig.action === 'buy' ? '🟢' : sig.action === 'sell' ? '🔴' : '⏸';
      const actionText = sig.action === 'buy' ? 'Long' : sig.action === 'sell' ? 'Short' : 'Hold';
      const confColor = sig.confidence >= 80 ? '🔥' : sig.confidence >= 70 ? '✅' : '⚠️';

      lines.push(
        `${icon} <b>${(sig.symbol || '').replace('USDT', 'USDT')}</b> — ${actionText}`,
        `   ${confColor} اطمینان: ${sig.confidence || 0}%`,
        `   💰 ورود: $${(sig.entryPrice || 0).toFixed(4)}`,
        `   ✅ هدف: $${(sig.targetPrice || 0).toFixed(4)}`,
        `   🛑 SL: $${(sig.stopLoss || 0).toFixed(4)}`,
        `   📈 لوریج: ${sig.leverage || 1}x | RR 1:${(sig.riskReward || 0).toFixed(1)}`,
        ''
      );
    }

    await sendMessageDirect(token, chatId, lines.join('\n'));
  } catch (e) {
    console.log('[Telegram] Signals command error', e);
    await sendMessageDirect(token, chatId, '❌ خطا در دریافت سیگنال‌ها.');
  }
}

async function handlePositionsCommand(token: string, chatId: string): Promise<void> {
  try {
    const demoStr = await AsyncStorage.getItem(DEMO_KEY);
    const demo = demoStr ? JSON.parse(demoStr) : null;
    const demoPositions = demo?.positions || [];

    const autoLogStr = await AsyncStorage.getItem(AUTO_TRADE_LOG_KEY);
    const autoLogs = autoLogStr ? JSON.parse(autoLogStr) : [];

    const lines = ['📈 <b>پوزیشن‌های فعال</b>\n'];

    if (demoPositions.length > 0) {
      lines.push('🎮 <b>پوزیشن‌های دمو</b>');
      for (const pos of demoPositions) {
        const sideIcon = pos.side === 'long' ? '🟢' : '🔴';
        const sideText = pos.side === 'long' ? 'Long' : 'Short';
        const pnlIcon = (pos.pnl || 0) >= 0 ? '📈' : '📉';

        lines.push(
          `${sideIcon} <b>${(pos.symbol || '').replace('USDT', 'USDT')}</b> ${sideText}`,
          `   ورود: $${(pos.entryPrice || 0).toFixed(4)}`,
          `   فعلی: $${(pos.currentPrice || pos.entryPrice || 0).toFixed(4)}`,
          `   ${pnlIcon} سود/زیان: ${(pos.pnl || 0) >= 0 ? '+' : ''}$${(pos.pnl || 0).toFixed(2)} (${(pos.pnlPercent || 0) >= 0 ? '+' : ''}${(pos.pnlPercent || 0).toFixed(2)}%)`,
          `   لوریج: ${pos.leverage || 1}x | حجم: $${(pos.amount || 0).toFixed(2)}`,
          ''
        );
      }
    } else {
      lines.push('🎮 پوزیشن دمو ندارید');
      lines.push('');
    }

    if (autoLogs.length > 0) {
      lines.push('📋 <b>آخرین فعالیت‌های ربات</b>');
      for (const log of autoLogs.slice(0, 5)) {
        const statusIcon = log.status === 'success' ? '✅' : '❌';
        const date = new Date(log.timestamp).toLocaleString('fa-IR');
        lines.push(
          `${statusIcon} ${log.symbol} — ${log.action} ($${(log.amount || 0).toFixed(2)})`,
          `   ${date} | ${log.message || ''}`,
          ''
        );
      }
    }

    lines.push('💡 <i>برای مدیریت پوزیشن‌ها از برنامه اصلی استفاده کنید.</i>');

    await sendMessageDirect(token, chatId, lines.join('\n'));
  } catch (e) {
    console.log('[Telegram] Positions command error', e);
    await sendMessageDirect(token, chatId, '❌ خطا در دریافت پوزیشن‌ها.');
  }
}

async function handleBalanceCommand(token: string, chatId: string): Promise<void> {
  try {
    const demoStr = await AsyncStorage.getItem(DEMO_KEY);
    const demo = demoStr ? JSON.parse(demoStr) : null;

    const exchangeStr = await AsyncStorage.getItem(EXCHANGE_CONFIGS_KEY);
    const exchanges = exchangeStr ? JSON.parse(exchangeStr) : [];

    const lines = ['💰 <b>موجودی حساب</b>\n'];

    if (demo) {
      const totalPnl = (demo.totalPnl || 0);
      const pnlIcon = totalPnl >= 0 ? '📈' : '📉';
      lines.push(
        '🎮 <b>حساب دمو</b>',
        `   موجودی: $${(demo.balance || 0).toFixed(2)}`,
        `   سرمایه اولیه: $${(demo.initialBalance || 10000).toFixed(2)}`,
        `   ${pnlIcon} سود/زیان کل: ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`,
        `   تعداد معاملات: ${(demo.tradeHistory || []).length}`,
        `   پوزیشن باز: ${(demo.positions || []).length}`,
        ''
      );
    } else {
      lines.push('🎮 حساب دمو فعال نشده');
      lines.push('');
    }

    if (exchanges.length > 0) {
      lines.push('🏦 <b>صرافی‌های متصل</b>');
      for (const ex of exchanges) {
        const statusIcon = ex.enabled ? '✅' : '❌';
        lines.push(
          `${statusIcon} <b>${ex.exchangeId}</b>`,
          `   API: ${ex.apiKey ? '****' + ex.apiKey.slice(-4) : 'تنظیم نشده'}`,
          `   منبع سیگنال: ${ex.tradeSource === 'ai' ? 'AI' : ex.tradeSource === 'scanner' ? 'اسکنر' : 'هردو'}`,
          `   ارزها: ${ex.tradeAllSymbols ? 'همه' : (ex.selectedSymbols || []).join(', ') || 'انتخاب نشده'}`,
          ''
        );
      }
    } else {
      lines.push('🏦 هیچ صرافی متصل نیست');
      lines.push('');
    }

    lines.push('💡 <i>برای مشاهده موجودی واقعی صرافی، از بخش «کیف پول» در برنامه استفاده کنید.</i>');

    await sendMessageDirect(token, chatId, lines.join('\n'));
  } catch (e) {
    console.log('[Telegram] Balance command error', e);
    await sendMessageDirect(token, chatId, '❌ خطا در دریافت موجودی.');
  }
}

async function handleScannerCommand(token: string, chatId: string): Promise<void> {
  try {
    const signalsStr = await AsyncStorage.getItem(SIGNALS_KEY);
    const signals = signalsStr ? JSON.parse(signalsStr) : [];

    const settingsStr = await AsyncStorage.getItem(SETTINGS_KEY);
    const settingsData = settingsStr ? JSON.parse(settingsStr) : {};

    if (signals.length === 0) {
      await sendMessageDirect(token, chatId, '🔍 اسکنر فعال است اما هنوز سیگنالی شناسایی نشده.\n\nصبر کنید یا از برنامه اسکن دستی انجام دهید.');
      return;
    }

    const pumpSignals = signals.filter((s: { signalType: string }) => s.signalType === 'pump');
    const dumpSignals = signals.filter((s: { signalType: string }) => s.signalType === 'dump');

    const lines = [
      '🔍 <b>وضعیت اسکنر سیگنال</b>',
      '',
      `📊 مجموع: ${signals.length} سیگنال (🟢 ${pumpSignals.length} پامپ | 🔴 ${dumpSignals.length} دامپ)`,
      `⚙️ حالت: ${settingsData.useVolumeOnlySignals ? 'فقط حجمی' : 'Confluence'}`,
      `🔄 بازه اسکن: ${settingsData.scanInterval || 60} ثانیه`,
      '',
    ];

    if (pumpSignals.length > 0) {
      lines.push(`🟢 <b>سیگنال‌های پامپ (${pumpSignals.length})</b>`);
      // ALL pump signals are listed — long messages are split automatically.
      for (const sig of pumpSignals) {
        const strengthIcon = sig.strength === 'high' ? '💪' : sig.strength === 'medium' ? '📊' : '📉';
        lines.push(
          `  ${strengthIcon} <b>${sig.displayName || sig.symbol}</b>`,
          `     قیمت: $${(sig.currentPrice || 0).toFixed(4)} | تغییر: ${(sig.priceChangePercent || 0) >= 0 ? '+' : ''}${(sig.priceChangePercent || 0).toFixed(2)}%`,
          `     ورود: $${(sig.suggestedEntry || 0).toFixed(4)} | هدف: $${(sig.suggestedTarget || 0).toFixed(4)}`,
          ''
        );
      }
    }

    if (dumpSignals.length > 0) {
      lines.push(`🔴 <b>سیگنال‌های دامپ (${dumpSignals.length})</b>`);
      // ALL dump signals are listed — long messages are split automatically.
      for (const sig of dumpSignals) {
        const strengthIcon = sig.strength === 'high' ? '💪' : sig.strength === 'medium' ? '📊' : '📉';
        lines.push(
          `  ${strengthIcon} <b>${sig.displayName || sig.symbol}</b>`,
          `     قیمت: $${(sig.currentPrice || 0).toFixed(4)} | تغییر: ${(sig.priceChangePercent || 0) >= 0 ? '+' : ''}${(sig.priceChangePercent || 0).toFixed(2)}%`,
          `     ورود: $${(sig.suggestedEntry || 0).toFixed(4)} | هدف: $${(sig.suggestedTarget || 0).toFixed(4)}`,
          ''
        );
      }
    }

    await sendMessageDirect(token, chatId, lines.join('\n'));
  } catch (e) {
    console.log('[Telegram] Scanner command error', e);
    await sendMessageDirect(token, chatId, '❌ خطا در دریافت اطلاعات اسکنر.');
  }
}

async function handleMemeCommand(token: string, chatId: string): Promise<void> {
  try {
    const lines = [
      '💀 <b>اسکنر میم‌کوین</b>',
      '',
      '🔄 در حال بررسی DexScreener و Birdeye...',
      '',
    ];

    try {
      const res = await fetch('https://api.dexscreener.com/token-boosts/latest/v1');
      if (res.ok) {
        const data = await res.json();
        const tokens = Array.isArray(data) ? data.slice(0, 8) : [];

        if (tokens.length > 0) {
          lines.push('🔥 <b>میم‌کوین‌های داغ (Boosted)</b>');
          lines.push('');
          for (const t of tokens) {
            const name = t.description || t.tokenAddress?.slice(0, 8) || 'Unknown';
            const chain = t.chainId || 'solana';
            const link = t.url || '';
            lines.push(
              `• <b>${name}</b> (${chain})`,
              `  ${link ? `🔗 ${link}` : ''}`,
              ''
            );
          }
        } else {
          lines.push('📭 توکن بوست‌شده‌ای یافت نشد.');
        }
      }
    } catch {
      lines.push('⚠️ خطا در دریافت داده از DexScreener');
    }

    try {
      const trendRes = await fetch('https://api.dexscreener.com/latest/dex/search?q=meme+pump');
      if (trendRes.ok) {
        const trendData = await trendRes.json();
        const pairs = (trendData.pairs || []).slice(0, 5);

        if (pairs.length > 0) {
          lines.push('');
          lines.push('📈 <b>میم‌کوین‌های ترند</b>');
          lines.push('');
          for (const p of pairs) {
            const name = p.baseToken?.name || 'Unknown';
            const symbol = p.baseToken?.symbol || '';
            const price = p.priceUsd ? `$${parseFloat(p.priceUsd).toFixed(6)}` : 'N/A';
            const change = p.priceChange?.h24 ? `${p.priceChange.h24}%` : 'N/A';
            const vol = p.volume?.h24 ? `$${(p.volume.h24 / 1000).toFixed(1)}K` : 'N/A';
            const dex = p.dexId || '';

            lines.push(
              `💎 <b>${name} (${symbol})</b>`,
              `   قیمت: ${price} | تغییر ۲۴h: ${change}`,
              `   حجم ۲۴h: ${vol} | DEX: ${dex}`,
              ''
            );
          }
        }
      }
    } catch {
      lines.push('⚠️ خطا در دریافت ترند میم‌ها');
    }

    lines.push('💡 <i>برای جزئیات بیشتر و ترید، از برنامه اصلی استفاده کنید.</i>');

    await sendMessageDirect(token, chatId, lines.join('\n'));
  } catch (e) {
    console.log('[Telegram] Meme command error', e);
    await sendMessageDirect(token, chatId, '❌ خطا در اسکنر میم‌کوین.');
  }
}

async function handleWhaleCommand(token: string, chatId: string): Promise<void> {
  try {
    const walletsStr = await AsyncStorage.getItem(TRACKED_WALLETS_KEY);
    const wallets = walletsStr ? JSON.parse(walletsStr) : [];

    const lines = ['🐋 <b>ردیابی نهنگ‌ها</b>\n'];

    if (wallets.length === 0) {
      lines.push(
        '📭 هیچ کیف‌پول نهنگی ردیابی نمی‌شود.',
        '',
        '💡 از بخش «ردیابی نهنگ‌ها» در برنامه آدرس اضافه کنید.',
      );
    } else {
      lines.push(`📊 تعداد نهنگ‌های ردیابی‌شده: ${wallets.length}\n`);

      for (const w of wallets.slice(0, 10)) {
        const addr = w.address || '';
        const label = w.label || w.name || 'بدون نام';
        const shortAddr = addr.length > 16 ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : addr;

        lines.push(
          `👛 <b>${label}</b>`,
          `   آدرس: <code>${shortAddr}</code>`,
          ''
        );
      }

      if (wallets.length > 10) {
        lines.push(`... و ${wallets.length - 10} نهنگ دیگر`);
      }
    }

    lines.push('');
    lines.push('💡 <i>جزئیات معاملات و توکن‌های هر نهنگ از برنامه قابل مشاهده است.</i>');

    await sendMessageDirect(token, chatId, lines.join('\n'));
  } catch (e) {
    console.log('[Telegram] Whale command error', e);
    await sendMessageDirect(token, chatId, '❌ خطا در دریافت اطلاعات نهنگ‌ها.');
  }
}

async function handleGainzCommand(token: string, chatId: string): Promise<void> {
  try {
    await sendMessageDirect(token, chatId,
      '📊 <b>اسکن اندیکاتور GainzAlgo</b>\n\n⏳ در حال بررسی Binance Futures... (چند ثانیه طول می‌کشد)'
    );

    // Fresh local scan (on the user's selected timeframes) + everything the
    // server computed while the app was closed, merged and deduped by id.
    let selectedTfs: GainzTimeframe[] | undefined;
    try {
      const settingsStr = await AsyncStorage.getItem(SETTINGS_KEY);
      const settings = settingsStr ? JSON.parse(settingsStr) : {};
      if (Array.isArray(settings.gainzTimeframes) && settings.gainzTimeframes.length > 0) {
        selectedTfs = settings.gainzTimeframes;
      }
    } catch {}
    const [signals, serverRes] = await Promise.all([
      scanGainzAlgoDailySignals({ maxSymbols: 40, timeframes: selectedTfs }).catch(
        () => [] as GainzAlgoSignal[]
      ),
      fetchServerSignals().catch(() => null),
    ]);
    const serverSignals = serverRes?.gainzSignals || [];
    const freshIds = new Set(signals.map((s) => s.id));
    const merged = [...signals, ...serverSignals.filter((s) => !freshIds.has(s.id))];

    if (merged.length === 0) {
      await sendMessageDirect(token, chatId,
        '📭 هیچ ارزی سیگنال خرید/فروش نداده است.\n\nسرور به صورت خودکار بررسی می‌کند و اولین سیگنال را اعلام خواهد کرد.'
      );
      return;
    }

    const buyCount = merged.filter((s) => s.action === 'buy').length;
    const sellCount = merged.length - buyCount;
    const lines = [
      '📊 <b>اندیکاتور GainzAlgo Pro</b>',
      `🟢 ${buyCount} خرید | 🔴 ${sellCount} فروش\n`,
    ];
    // Group by timeframe and list EVERY signal — no truncation.
    for (const tf of GAINZ_TF_ORDER) {
      const group = merged.filter((s) => (s.timeframe ?? '1d') === tf);
      if (group.length === 0) continue;
      lines.push(`⏱ <b>تایم‌فریم ${GAINZ_TF_LABEL[tf]}</b> — ${group.length} سیگنال`);
      for (const sig of group) {
        const icon = sig.action === 'buy' ? '🟢' : '🔴';
        const action = sig.action === 'buy' ? '<b>BUY</b>' : '<b>SELL</b>';
        lines.push(
          `${icon} <b>${sig.displayName}</b> — ${action}`,
          `   قیمت: $${sig.price.toFixed(4)} | RSI(14): ${sig.rsi}`,
          candleTimeLine(tf, sig.candleOpenTime, sig.live, GAINZ_TF_LABEL[tf]),
          ...(sig.markets
            ? [
                `   🏦 بازار Binance: ${sig.markets
                  .map((m) => (m === 'futures' ? 'فیوچرز' : 'اسپات'))
                  .join(' | ')}`,
              ]
            : []),
          ''
        );
      }
    }
    lines.push('📉 داده از Binance • همه تایم‌فریم‌های انتخابی در برنامه');
    await sendMessageDirect(token, chatId, lines.join('\n'));
  } catch (e) {
    console.log('[Telegram] Gainz command error', e);
    await sendMessageDirect(token, chatId, '❌ خطا در اسکن اندیکاتور GainzAlgo.');
  }
}

async function handleIndicatorsCommand(token: string, chatId: string): Promise<void> {
  try {
    // Merge locally stored signals with what the server computed while the
    // app was closed so indicators shows the full picture.
    const [indicators, localSignals, serverRes] = await Promise.all([
      getUserIndicators(),
      getStoredCustomSignals(),
      fetchServerSignals().catch(() => null),
    ]);
    const serverCustom = serverRes?.customSignals || [];
    const localIds = new Set(localSignals.map((s) => s.id));
    const signals = [...localSignals, ...serverCustom.filter((s) => !localIds.has(s.id))];

    if (indicators.length === 0) {
      await sendMessageDirect(token, chatId,
        '🧩 <b>اندیکاتورهای دستی</b>\n\n📭 هنوز هیچ اندیکاتور اختصاصی اضافه نکرده‌اید.\n\n💡 از تب «اندیکاتورها» در برنامه، کد اندیکاتور خود را اضافه کنید؛ سیگنال‌هایش به صورت خودکار همین‌جا اعلام می‌شود.'
      );
      return;
    }

    const lines = ['🧩 <b>اندیکاتورهای دستی شما</b>\n'];
    for (const ind of indicators) {
      const statusIcon = ind.receiveSignals ? '✅ فعال' : '❌ غیرفعال';
      lines.push(
        `📐 <b>${ind.name}</b> (${ind.timeframe})`,
        `   وضعیت: ${statusIcon}`,
        ''
      );
    }

    if (signals.length > 0) {
      lines.push(`📋 <b>آخرین سیگنال‌ها (${signals.length})</b>`);
      // ALL custom-indicator signals — long messages are split automatically.
      for (const sig of signals) {
        const icon = sig.action === 'buy' ? '🟢' : '🔴';
        lines.push(
          `${icon} <b>${sig.displayName}</b> — ${sig.action === 'buy' ? 'BUY' : 'SELL'}`,
          `   🧩 ${sig.indicatorName} | قیمت: $${sig.price.toFixed(4)}`,
          candleTimeLine(sig.timeframe ?? '1d', sig.candleOpenTime, sig.live),
          ''
        );
      }
    } else {
      lines.push('📭 هنوز سیگنالی از اندیکاتورهای شما ثبت نشده است.');
    }

    lines.push('💡 <i>برای افزودن/ویرایش/غیرفعال کردن اندیکاتور از تب «اندیکاتورها» در برنامه استفاده کنید.</i>');
    await sendMessageDirect(token, chatId, lines.join('\n'));
  } catch (e) {
    console.log('[Telegram] Indicators command error', e);
    await sendMessageDirect(token, chatId, '❌ خطا در دریافت اندیکاتورهای دستی.');
  }
}

async function handleHookCommand(token: string, chatId: string): Promise<void> {
  try {
    // Merge locally stored signals with what the server computed while the
    // app was closed so hook shows the full picture.
    const [localSignals, serverRes] = await Promise.all([
      getStoredHookSignals(),
      fetchServerSignals().catch(() => null),
    ]);
    const serverHook = serverRes?.hookSignals || [];
    const localIds = new Set(localSignals.map((s) => s.id));
    const signals: HookReversalSignal[] = [
      ...localSignals,
      ...serverHook.filter((s) => !localIds.has(s.id)),
    ];

    if (signals.length === 0) {
      await sendMessageDirect(token, chatId,
        '🪝 <b>هوک ریورسال</b>\n\n📭 هنوز سیگنالی ثبت نشده است.\n\n💡 تایم‌فریم‌های دلخواه (۴ ساعته / روزانه) را در تب «اندیکاتورها» فعال کنید؛ سرور به‌صورت خودکار اسکن می‌کند و هوک‌های صعودی/نزولی همین‌جا اعلام می‌شوند.'
      );
      return;
    }

    const lines = [`🪝 <b>هوک ریورسال — آخرین سیگنال‌ها (${signals.length})</b>\n`];
    // ALL hook signals — long messages are split automatically.
    for (const sig of signals) {
      const icon = sig.action === 'buy' ? '🟢' : '🔴';
      lines.push(
        `${icon} <b>${sig.displayName}</b> — ${sig.action === 'buy' ? 'هوک صعودی' : 'هوک نزولی'}`,
        `   💰 قیمت: $${sig.price.toFixed(4)} | ⏱ ${HOOK_TF_LABEL[sig.timeframe] || sig.timeframe}`,
        candleTimeLine(sig.timeframe, sig.candleOpenTime, sig.live, HOOK_TF_LABEL[sig.timeframe]),
        ''
      );
    }
    lines.push('💡 <i>برای انتخاب تایم‌فریم از تب «اندیکاتورها» در برنامه استفاده کنید.</i>');
    await sendMessageDirect(token, chatId, lines.join('\n'));
  } catch (e) {
    console.log('[Telegram] Hook command error', e);
    await sendMessageDirect(token, chatId, '❌ خطا در دریافت سیگنال‌های هوک ریورسال.');
  }
}

async function handleHelpCommand(token: string, chatId: string): Promise<void> {
  const text = [
    '❓ <b>راهنمای Trade Master Bot</b>',
    '',
    '📋 <b>دستورات موجود</b>',
    '',
    '/start - 🚀 شروع و نمایش منوی اصلی',
    '/status - 📊 وضعیت کلی شامل',
    '   • تعداد سیگنال‌های فعال اسکنر',
    '   • وضعیت ربات اتوماتیک',
    '   • صرافی‌های متصل',
    '   • وضعیت اعلان‌ها',
    '',
    '/signals - 🎯 آخرین سیگنال‌های AI شامل',
    '   • جهت (Long/Short/Hold)',
    '   • درصد اطمینان (Confidence)',
    '   • قیمت ورود، هدف و حد ضرر',
    '   • لوریج و RR',
    '',
    '/positions - 📈 پوزیشن‌های باز',
    '   • پوزیشن‌های دمو و واقعی',
    '   • سود/زیان هر پوزیشن',
    '   • آخرین فعالیت‌های ربات',
    '',
    '/balance - 💰 موجودی حساب',
    '   • موجودی حساب دمو',
    '   • صرافی‌های متصل و تنظیمات',
    '',
    '/scanner - 🔍 اسکنر سیگنال',
    '   • سیگنال‌های پامپ و دامپ فعال',
    '   • حالت سیگنال‌دهی (حجمی/Confluence)',
    '',
    '/meme - 💀 اسکنر میم‌کوین',
    '   • میم‌کوین‌های بوست‌شده',
    '   • ترندهای فعلی بازار میم',
    '',
    '/whale - 🐋 ردیابی نهنگ‌ها',
    '   • لیست نهنگ‌های ردیابی‌شده',
    '   • آدرس کیف‌پول‌ها',
    '',
    '/gainz - 📊 اندیکاتور GainzAlgo Pro',
    '   • سیگنال‌های خرید/فروش در تایم‌فریم‌های ۱ ساعته، ۴ ساعته و روزانه',
    '   • اسکن خودکار سرور هر ساعت حتی وقتی برنامه بسته است',
    '   • محاسبه RSI و پوشش گیاهی (Engulfing) + نوع بازار (فیوچرز/اسپات)',
    '   • داده زنده از Binance',
    '',
    '/indicators - 🧩 اندیکاتورهای دستی',
    '   • لیست اندیکاتورهای اختصاصی شما و وضعیتشان',
    '   • آخرین سیگنال‌های ثبت‌شده هر اندیکاتور',
    '   • در برنامه، فیلتر روزها بر اساس زمان کشف سیگنال است؛ کندل روزانه‌ای که شب قبل بسته شده زیر «امروز» می‌آید',
    '',
    '/hook - 🪝 هوک ریورسال',
    '   • هوک صعودی: کف پایین‌تر از کندل قبل + بسته‌شدن بالاتر (احتمال برگشت به بالا)',
    '   • هوک نزولی: سقف بالاتر از کندل قبل + بسته‌شدن پایین‌تر (احتمال برگشت به پایین)',
    '   • تایم‌فریم‌های ۴ ساعته و روزانه — اسکن خودکار سرور حتی با برنامه بسته',
    '',
    '🔔 <b>اعلان‌های خودکار</b>',
    'ربات به صورت خودکار این اعلان‌ها را ارسال می‌کند:',
    '• 🔍 سیگنال‌های جدید اسکنر (پامپ/دامپ)',
    '• 🤖 سیگنال‌های AI با جزئیات Confluence',
    '• 📈 باز شدن پوزیشن (دمو و واقعی)',
    '• 📉 بسته شدن پوزیشن با سود/زیان',
    '• 💀 سیگنال شورت میم‌کوین',
    '• 🚀 میم‌کوین قبل از لیست شدن',
    '• 🐋 فعالیت مهم نهنگ‌ها',
    '• 📊 سیگنال خرید/فروش اندیکاتور GainzAlgo (۱ ساعته | ۴ ساعته | روزانه)',
    '• 🧩 سیگنال‌های اندیکاتورهای دستی شما',
    '• 🪝 هوک ریورسال صعودی/نزولی (۴ ساعته و روزانه)',
    '',
    '⚙️ <b>تنظیمات</b>',
    'تمام تنظیمات از داخل برنامه اصلی قابل مدیریت است:',
    '• فعال/غیرفعال کردن هر نوع اعلان',
    '• تنظیم بازه بروزرسانی',
    '• مدیریت API صرافی‌ها',
    '• تنظیم استراتژی و اندیکاتورها',
    '• قیمت تتر/تومان در بخش «مدیریت دارایی» هر ۶۰ ثانیه خودکار بروزرسانی می‌شود',
    '',
    '👨‍💻 طراح: trade_master65',
    '📸 اینستاگرام: @trade_master65',
  ].join('\n');

  await sendMessageDirect(token, chatId, text);
}

async function pollTelegramUpdates(): Promise<void> {
  if (isPolling) return;
  isPolling = true;

  try {
    const tg = await getTelegramSettings();
    if (!tg) {
      isPolling = false;
      return;
    }

    // v1.4.3: when the server handles bot commands 24/7 (getUpdates), the
    // app must NOT also poll getUpdates (the two would race and updates
    // would be consumed unpredictably). Instead it fetches the commands the
    // server queued for it (those needing app-local data) and answers them.
    const serverMode = await serverSupportsBotCommands();
    if (serverMode) {
      const pending = await fetchPendingBotCommands();
      if (pending.length === 0) {
        isPolling = false;
        return;
      }
      const answeredIds: number[] = [];
      for (const cmd of pending.slice(0, 10)) {
        try {
          console.log(`[Telegram] Answering queued command ${cmd.command} from server`);
          await handleCommand(cmd.command, tg.telegramBotToken, cmd.chatId);
          answeredIds.push(cmd.id);
        } catch (e) {
          console.log('[Telegram] Queued command error:', e);
        }
      }
      await ackBotCommands(answeredIds);
      isPolling = false;
      return;
    }

    // Legacy mode: no server command support → the app polls getUpdates
    // itself (commands only answered while the app is open).
    const offset = await getLastOffset();

    const url = `https://api.telegram.org/bot${tg.telegramBotToken}/getUpdates?offset=${offset + 1}&limit=10&timeout=0`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.ok || !data.result || data.result.length === 0) {
      isPolling = false;
      return;
    }

    let maxOffset = offset;
    for (const update of data.result) {
      const updateId = update.update_id;
      if (updateId > maxOffset) maxOffset = updateId;

      const msg = update.message;
      if (!msg || !msg.text) continue;

      const chatId = String(msg.chat.id || tg.telegramChatId);
      const text = msg.text.trim();

      if (text.startsWith('/')) {
        const command = text.split('@')[0].split(' ')[0].toLowerCase();
        console.log(`[Telegram] Received command ${command} from chat ${chatId}`);
        await handleCommand(command, tg.telegramBotToken, chatId);
      }
    }

    if (maxOffset > offset) {
      await saveLastOffset(maxOffset);
    }
  } catch (e) {
    console.log('[Telegram] Polling error', e);
  }

  isPolling = false;
}

/**
 * Starts the bot command listener (v1.4.3 smart mode):
 *  - server handles commands 24/7 → app answers only the queued
 *    app-local commands (/balance /positions /signals /whale);
 *  - server without command support → legacy local getUpdates polling.
 * Called automatically from AppContext when Telegram is enabled.
 */
export function startTelegramPolling(): void {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }

  console.log('[Telegram] Starting bot command listener (every 3s)...');
  pollTelegramUpdates();
  pollingInterval = setInterval(pollTelegramUpdates, 3000);
}

export function stopTelegramPolling(): void {
  if (pollingInterval) {
    console.log('[Telegram] Stopping bot polling');
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

export async function sendTelegramSignalNotification(signals: Array<{
  symbol: string;
  displayName: string;
  signalType: 'pump' | 'dump';
  currentPrice: number;
  priceChangePercent: number;
  strength: string;
  suggestedEntry: number;
  suggestedTarget: number;
  suggestedStopLoss: number;
}>): Promise<void> {
  if (signals.length === 0) return;

  const lines: string[] = ['🔔 <b>سیگنال‌های جدید اسکنر</b>\n'];

  // ALL new scanner signals — the sender splits long messages automatically.
  for (const sig of signals) {
    const icon = sig.signalType === 'pump' ? '🟢' : '🔴';
    const type = sig.signalType === 'pump' ? 'پامپ' : 'دامپ';
    const strengthText = sig.strength === 'high' ? '💪 قوی' : sig.strength === 'medium' ? '📊 متوسط' : '📉 ضعیف';

    lines.push(
      `${icon} <b>${sig.displayName}</b> - ${type}`,
      `   قیمت: $${sig.currentPrice.toFixed(4)}`,
      `   تغییر: ${sig.priceChangePercent >= 0 ? '+' : ''}${sig.priceChangePercent.toFixed(2)}%`,
      `   قدرت: ${strengthText}`,
      `   ورود: $${sig.suggestedEntry.toFixed(4)} | هدف: $${sig.suggestedTarget.toFixed(4)} | SL: $${sig.suggestedStopLoss.toFixed(4)}`,
      ''
    );
  }

  await sendTelegramMessage(lines.join('\n'));
}

export async function sendTelegramAISignal(signal: {
  symbol: string;
  action: string;
  confidence: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  leverage: number;
  reasoning: string;
  riskReward: number;
  timeframe: string;
}): Promise<void> {
  const icon = signal.action === 'buy' ? '🟢' : signal.action === 'sell' ? '🔴' : '⏸';
  const actionText = signal.action === 'buy' ? 'خرید (Long)' : signal.action === 'sell' ? 'فروش (Short)' : 'صبر';

  const text = [
    `${icon} <b>سیگنال AI - ${signal.symbol.replace('USDT', 'USDT')}</b>`,
    '',
    `📊 عمل: <b>${actionText}</b>`,
    `🎯 اطمینان: <b>${signal.confidence}%</b>`,
    `⏱ تایم‌فریم: ${signal.timeframe}`,
    '',
    `💰 ورود: $${signal.entryPrice.toFixed(4)}`,
    `✅ هدف: $${signal.targetPrice.toFixed(4)}`,
    `🛑 حد ضرر: $${signal.stopLoss.toFixed(4)}`,
    `📈 اهرم: ${signal.leverage}x`,
    `⚖️ RR 1:${signal.riskReward}`,
    '',
    `📝 تحلیل: ${signal.reasoning.slice(0, 300)}${signal.reasoning.length > 300 ? '...' : ''}`,
  ].join('\n');

  await sendTelegramMessage(text);
}

export async function sendTelegramTradeNotification(params: {
  type: 'open' | 'close';
  symbol: string;
  side: string;
  amount: number;
  leverage: number;
  price: number;
  pnl?: number;
  exchangeName?: string;
  isDemo: boolean;
}): Promise<void> {
  const modeText = params.isDemo ? '(دمو)' : '(واقعی)';
  const sideIcon = params.side === 'long' ? '🟢' : '🔴';
  const sideText = params.side === 'long' ? 'Long' : 'Short';

  let text = '';
  if (params.type === 'open') {
    text = [
      `${sideIcon} <b>پوزیشن باز شد ${modeText}</b>`,
      '',
      `🪙 ارز: ${params.symbol.replace('USDT', 'USDT')}`,
      `📊 جهت: ${sideText}`,
      `💰 حجم: $${params.amount.toFixed(2)}`,
      `📈 اهرم: ${params.leverage}x`,
      `💵 قیمت ورود: $${params.price.toFixed(4)}`,
      params.exchangeName ? `🏦 صرافی: ${params.exchangeName}` : '',
    ].filter(Boolean).join('\n');
  } else {
    const pnlIcon = (params.pnl || 0) >= 0 ? '✅' : '❌';
    text = [
      `${pnlIcon} <b>پوزیشن بسته شد ${modeText}</b>`,
      '',
      `🪙 ارز: ${params.symbol.replace('USDT', 'USDT')}`,
      `📊 جهت: ${sideText}`,
      `💵 قیمت خروج: $${params.price.toFixed(4)}`,
      `💰 سود/زیان: ${(params.pnl || 0) >= 0 ? '+' : ''}$${(params.pnl || 0).toFixed(2)}`,
      params.exchangeName ? `🏦 صرافی: ${params.exchangeName}` : '',
    ].filter(Boolean).join('\n');
  }

  await sendTelegramMessage(text);
}

export async function sendTelegramMemeShortSignal(signal: {
  name: string;
  symbol: string;
  confidence: number;
  currentPrice: number;
  entryPrice: number;
  targets: number[];
  stopLoss: number;
  leverage: string;
}): Promise<void> {
  const text = [
    `💀 <b>سیگنال شورت میم‌کوین</b>`,
    '',
    `🪙 ${signal.name} (${signal.symbol})`,
    `🎯 اطمینان: <b>${signal.confidence}%</b>`,
    `💰 قیمت فعلی: $${signal.currentPrice}`,
    `📍 ورود: $${signal.entryPrice}`,
    ...signal.targets.map((t, i) => `✅ هدف ${i + 1}: $${t}`),
    `🛑 حد ضرر: $${signal.stopLoss}`,
    `📈 لوریج: ${signal.leverage}`,
    '',
    '⚠️ شورت میم‌کوین پرریسک است! فقط با سرمایه‌ای که حاضرید از دست بدید.',
  ].join('\n');

  await sendTelegramMessage(text);
}

export async function sendTelegramPreListingAlert(token: {
  name: string;
  symbol: string;
  currentPrice: number;
  marketCap: number;
  exchange: string;
  listingDate: string;
}): Promise<void> {
  const text = [
    `🚀 <b>میم‌کوین قبل از لیست شدن</b>`,
    '',
    `🪙 ${token.name} (${token.symbol})`,
    `💰 قیمت: $${token.currentPrice}`,
    `📊 مارکت‌کپ: $${(token.marketCap / 1e6).toFixed(2)}M`,
    `🏦 صرافی: ${token.exchange}`,
    `📅 تاریخ لیست: ${token.listingDate}`,
    '',
    '⚠️ خرید قبل از لیست بسیار پرریسک است! حتماً بررسی کنید.',
  ].join('\n');

  await sendTelegramMessage(text);
}

export async function sendTelegramWhaleAlert(params: {
  walletAddress: string;
  action: string;
  token: string;
  amount: number;
  price: number;
}): Promise<void> {
  const text = [
    `🐋 <b>فعالیت نهنگ</b>`,
    '',
    `👛 ${params.walletAddress.slice(0, 8)}...${params.walletAddress.slice(-6)}`,
    `📊 عمل: ${params.action}`,
    `🪙 توکن: ${params.token}`,
    `💰 مقدار: $${params.amount.toLocaleString()}`,
    `💵 قیمت: $${params.price.toFixed(4)}`,
  ].join('\n');

  await sendTelegramMessage(text);
}

export async function setupTelegramBotCommands(): Promise<void> {
  try {
    const tg = await getTelegramSettings();
    if (!tg) return;

    const commands = [
      { command: 'start', description: 'شروع و منوی اصلی' },
      { command: 'status', description: 'وضعیت کلی حساب و ربات' },
      { command: 'signals', description: 'آخرین سیگنال‌های AI' },
      { command: 'positions', description: 'پوزیشن‌های باز' },
      { command: 'balance', description: 'موجودی حساب' },
      { command: 'scanner', description: 'وضعیت اسکنر سیگنال' },
      { command: 'meme', description: 'اسکنر میم‌کوین' },
      { command: 'whale', description: 'ردیابی نهنگ‌ها' },
      { command: 'gainz', description: 'سیگنال اندیکاتور GainzAlgo (روزانه)' },
      { command: 'indicators', description: 'اندیکاتورهای دستی شما' },
      { command: 'hook', description: 'سیگنال‌های هوک ریورسال' },
      { command: 'help', description: 'راهنمای کامل' },
    ];

    await fetch(`https://api.telegram.org/bot${tg.telegramBotToken}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands }),
    });

    console.log('[Telegram] Bot commands set successfully');
  } catch (e) {
    console.log('[Telegram] Error setting commands', e);
  }
}

export async function sendTelegramWelcome(): Promise<void> {
  await setupTelegramBotCommands();
  const tg = await getTelegramSettings();
  if (!tg) return;
  await handleStartCommand(tg.telegramBotToken, tg.telegramChatId);
}

export { sendTelegramMessage };

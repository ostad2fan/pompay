/**
 * socialSignalsService.ts — v1.5.13
 *
 * «سیگنال‌های سوشال‌مدیا» — دریافت خودکار توییت‌های معتبر بدون هیچ سروری:
 * فقط اینترنت گوشی. منبع پیش‌فرض @CryptoNewton است و کاربر می‌تواند هر
 * کاربر توییتر دیگری را هم اضافه کند.
 *
 * روش دریافت (بدون Railway):
 *   توییتر API عمومی رایگان ندارد؛ اپ از گیت‌وی‌های عمومی Nitter/RSS استفاده
 *   می‌کند. چون این گیت‌وی‌ها هر از گاهی قطع/وصل می‌شوند:
 *     ۱) آخرین گیت‌وی سالم کش می‌شود و دفعه بعد اول همان امتحان می‌شود.
 *     ۲) اگر لیست استاتیک جواب نداد، از status.d420.de لیست اینستنس‌های
 *        سالمِ RSSدار گرفته می‌شود و به‌ترتیب امتحان می‌شوند (دیسکاوری).
 *   هر گیت‌وی با تایم‌اوت کوتاه امتحان می‌شود؛ اولین پاسخِ RSS معتبر کافی است.
 *
 * فیلتر سیگنال معتبر (طبق درخواست کاربر):
 *   • متن توییت باید حداقل یک $TICKER داشته باشد؛
 *   • توییت باید عکس چارت داشته باشد (pbs.twimg.com/media/...)؛
 *   • توییت‌های بدون عکس چارت «اصلاً» نمایش داده نمی‌شوند (بدون هیچ پیامی).
 *
 * حریم خصوصی منبع (پیش‌فرض خاموش — دو کلید داخل راهنمای همین تب):
 *   • نام کاربری (آیدی) منبع در برنامه و تلگرام نمایش داده نمی‌شود؛
 *   • لینک توییت هم نه در برنامه نه در تلگرام قرار نمی‌گیرد.
 *   با روشن کردن هر کلید، همان مورد در هر دو جا نشان داده می‌شود.
 *
 * بروزرسانی: طبق «بازه بروزرسانی» تنظیمات برنامه (settings.refreshInterval).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export interface SocialSignal {
  /** شناسه یکتای توییت (مستقل از گیت‌وی). */
  id: string;
  /** متن پاک‌شده توییت. */
  text: string;
  /** تیکرها بدون $ — مثلا ['LIT'] یا ['BTC']. */
  tickers: string[];
  /** عکس چارت (مستقیم از CDN توییتر). */
  imageUrl: string;
  /** لینک استاندارد توییت در x.com — فقط با کلید لینک نمایش داده می‌شود. */
  link: string;
  /** آیدی منبع (بدون @) — فقط با کلید نام کاربری نمایش داده می‌شود. */
  sourceUser: string;
  publishedAt: number;
  fetchedAt: number;
}

export interface SocialSource {
  /** آیدی توییتر بدون @ — مثلا CryptoNewton */
  user: string;
  /** منبع پیش‌فرض (قابل حذف نیست — کاربر فقط می‌تواند اضافه/حذفِ اضافه‌شده‌ها کند). */
  builtin?: boolean;
}

/** گیت‌وی‌های عمومی شناخته‌شده — {u} جای آیدی کاربر. */
const GATEWAYS = [
  'https://nitter.netbub.com/{u}/rss',
  'https://nitter.mie.foundation/{u}/rss',
  'https://xcancel.com/{u}/rss',
  'https://nitter.privacyredirect.com/{u}/rss',
  'https://nitter.tiekoetter.com/{u}/rss',
  'https://lightbrd.com/{u}/rss',
  'https://nitter.poast.org/{u}/rss',
];

const DISCOVERY_URL = 'https://status.d420.de/api/v1/instances';
const RSS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const SOURCES_KEY = '@social_signal_sources';
const SIGNALS_KEY = '@social_signals_latest';
const SEEN_KEY = '@social_signals_seen';
const GATEWAY_STATE_KEY = '@social_signals_gateway';
const TELEGRAM_SETTINGS_KEY = '@crypto_scanner_settings';

const MAX_SIGNALS = 30;
const MAX_SEEN = 500;
const FETCH_TIMEOUT_MS = 12_000;

/** منبع پیش‌فرض — طبق دموی تاییدشده. */
export const DEFAULT_SOCIAL_SOURCE: SocialSource = { user: 'CryptoNewton', builtin: true };

// ---------------------------------------------------------------------------
// منابع (پیش‌فرض + اضافه‌شده‌های کاربر)
// ---------------------------------------------------------------------------

export async function listSocialSources(): Promise<SocialSource[]> {
  try {
    const raw = await AsyncStorage.getItem(SOURCES_KEY);
    const extra: SocialSource[] = raw ? (JSON.parse(raw) as SocialSource[]) : [];
    const seen = new Set(extra.map((s) => s.user.toLowerCase()));
    const all = [DEFAULT_SOCIAL_SOURCE, ...extra];
    // هر منبع فقط یک بار (اگر کاربر همان پیش‌فرض را اضافه کرده باشد)
    return all.filter((s) => {
      const k = s.user.toLowerCase();
      if (seen.has(k) && !s.builtin) return false;
      seen.add(k);
      return true;
    });
  } catch {
    return [DEFAULT_SOCIAL_SOURCE];
  }
}

export async function addSocialSource(userInput: string): Promise<{ ok: boolean; error?: string }> {
  const user = normalizeTwitterUser(userInput);
  if (!user) return { ok: false, error: 'آیدی توییتر معتبر نیست (مثال: x.com/username یا username)' };
  const extra = await listSocialSources();
  if (extra.some((s) => s.user.toLowerCase() === user.toLowerCase())) {
    return { ok: false, error: 'این منبع از قبل اضافه شده است' };
  }
  const next = [...extra.filter((s) => !s.builtin), { user }];
  await AsyncStorage.setItem(SOURCES_KEY, JSON.stringify(next));
  return { ok: true };
}

export async function removeSocialSource(user: string): Promise<void> {
  const extra = await listSocialSources();
  await AsyncStorage.setItem(SOURCES_KEY, JSON.stringify(extra.filter((s) => s.user !== user)));
}

/** آیدی تمیز از لینک/ورودی کاربر — «https://x.com/abc» یا «@abc» → abc */
export function normalizeTwitterUser(input: string): string {
  let s = (input || '').trim();
  if (!s) return '';
  s = s.replace(/^@/, '');
  const m = s.match(/(?:twitter\.com|x\.com)\/([A-Za-z0-9_]{1,15})\/?$/i);
  if (m) return m[1];
  if (/^[A-Za-z0-9_]{1,15}$/.test(s)) return s;
  return '';
}

// ---------------------------------------------------------------------------
// واکشی RSS با چرخش گیت‌وی
// ---------------------------------------------------------------------------

let cachedGoodGateway: string | null = null;

interface GatewayState {
  lastGood?: string;
  savedAt?: number;
}

async function loadGatewayState(): Promise<GatewayState> {
  try {
    const raw = await AsyncStorage.getItem(GATEWAY_STATE_KEY);
    return raw ? (JSON.parse(raw) as GatewayState) : {};
  } catch {
    return {};
  }
}

async function saveGatewayState(st: GatewayState): Promise<void> {
  try {
    await AsyncStorage.setItem(GATEWAY_STATE_KEY, JSON.stringify(st));
  } catch {}
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': RSS_UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text || text.length < 80) throw new Error('پاسخ خالی');
    return text;
  } finally {
    clearTimeout(t);
  }
}

/** لیست گیت‌وی‌های سالمِ RSSدار از سرور وضعیت (دیسکاوری — اختیاری). */
async function discoverGateways(): Promise<string[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(DISCOVERY_URL, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      hosts?: { domain?: string; healthy?: boolean; rss?: boolean; is_bad_host?: boolean }[];
    };
    const hosts = (data.hosts ?? [])
      .filter((h) => h.healthy && h.rss && !h.is_bad_host && h.domain)
      .map((h) => `https://${h.domain}/{u}/rss`);
    return hosts.slice(0, 8);
  } catch {
    return [];
  }
}

/** RSS خام یک کاربر را از هر گیت‌وی ممکن می‌گیرد؛ خروجی متن RSS یا null. */
async function fetchUserRss(user: string): Promise<string | null> {
  const st = await loadGatewayState();
  const candidates: string[] = [];
  if (st.lastGood) candidates.push(st.lastGood);
  candidates.push(...GATEWAYS);

  for (const gw of candidates) {
    const url = gw.replace('{u}', encodeURIComponent(user));
    try {
      const body = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
      if (body.includes('<item>')) {
        cachedGoodGateway = gw;
        await saveGatewayState({ lastGood: gw, savedAt: Date.now() });
        return body;
      }
      console.log(`[SocialSignals] ${gw} پاسخ بدون item داد`);
    } catch (e) {
      console.log(`[SocialSignals] ${gw} خطا: ${(e as Error).message}`);
    }
  }

  // هیچ‌کدام از لیست شناخته‌شده جواب نداد → دیسکاوری اینستنس‌های سالم
  const discovered = await discoverGateways();
  for (const gw of discovered) {
    if (candidates.includes(gw)) continue;
    try {
      const body = await fetchWithTimeout(gw.replace('{u}', encodeURIComponent(user)), FETCH_TIMEOUT_MS);
      if (body.includes('<item>')) {
        cachedGoodGateway = gw;
        await saveGatewayState({ lastGood: gw, savedAt: Date.now() });
        return body;
      }
    } catch {}
  }
  return null;
}

// ---------------------------------------------------------------------------
// پارس RSS → توییت‌ها → سیگنال معتبر
// ---------------------------------------------------------------------------

function xmlText(s: string): string {
  let out = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  out = out
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, '&');
  return out.trim();
}

function cleanDescription(s: string): string {
  let out = s.replace(/<br\s*\/?>/gi, '\n');
  out = out.replace(/<[^>]+>/g, '');
  return xmlText(out).trim();
}

function parsePubDate(s: string): number {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

interface ParsedTweet {
  id: string;
  text: string;
  tickers: string[];
  imageUrl?: string;
  link: string;
  sourceUser: string;
  publishedAt: number;
}

function parseRss(rss: string): ParsedTweet[] {
  const items = rss.match(/<item>[\s\S]*?<\/item>/g) ?? [];
  const tweets: ParsedTweet[] = [];
  for (const it of items.slice(0, 30)) {
    try {
      const title = xmlText((it.match(/<title>([\s\S]*?)<\/title>/) ?? ['', ''])[1]);
      const descRaw = (it.match(/<description>([\s\S]*?)<\/description>/) ?? ['', ''])[1];
      const link = xmlText((it.match(/<link>([\s\S]*?)<\/link>/) ?? ['', ''])[1]);
      const pubDate = xmlText((it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) ?? ['', ''])[1]);
      if (!title) continue;

      // شناسه توییت از لینک (مستقل از گیت‌وی)
      const idM = link.match(/\/status\/(\d+)/) || title.match(/\/status\/(\d+)/);
      if (!idM) continue;
      const id = idM[1];

      // نویسنده: «User: متن» یا «RT by @x: متن»
      let sourceUser = 'unknown';
      let text = title;
      const colon = title.indexOf(': ');
      if (colon > 0) {
        const head = title.slice(0, colon).replace(/^RT by @/, '');
        if (/^[A-Za-z0-9_]{1,15}$/.test(head)) {
          sourceUser = head;
          text = title.slice(colon + 2);
        }
      }
      const desc = cleanDescription(descRaw);
      if (desc && desc.length > text.length) text = desc;

      // عکس چارت — فقط تصاویر pbs.twimg.com/media معتبرند
      const imgM = it.match(/https:\/\/pbs\.twimg\.com\/media\/[^\s"'<>\]]+/);
      const imageUrl = imgM ? imgM[0] : undefined;

      // تیکرها: $TAG از متن + عنوان
      const tagStr = `${text} ${title}`;
      const tickers = Array.from(
        new Set((tagStr.match(/\$([A-Za-z][A-Za-z0-9]{0,15})/g) ?? []).map((t) => t.slice(1).toUpperCase()))
      );

      tweets.push({
        id,
        text,
        tickers,
        imageUrl,
        link: `https://x.com/${sourceUser}/status/${id}`,
        sourceUser,
        publishedAt: parsePubDate(pubDate),
      });
    } catch (e) {
      console.log('[SocialSignals] پارس یک آیتم ناموفق:', (e as Error).message);
    }
  }
  return tweets;
}

/** فقط توییت‌های دارای $تیکر و عکس چارت معتبرند — بقیه کلاً حذف می‌شوند. */
function toValidSignal(t: ParsedTweet): SocialSignal | null {
  if (t.tickers.length === 0) return null;
  if (!t.imageUrl) return null;
  const text = t.text.replace(/\s+/g, ' ').trim();
  if (text.length < 5) return null;
  return {
    id: t.id,
    text,
    tickers: t.tickers,
    imageUrl: t.imageUrl,
    link: t.link,
    sourceUser: t.sourceUser,
    publishedAt: t.publishedAt || Date.now(),
    fetchedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// ذخیره‌سازی + چرخه بروزرسانی
// ---------------------------------------------------------------------------

export async function loadSocialSignals(): Promise<SocialSignal[]> {
  try {
    const raw = await AsyncStorage.getItem(SIGNALS_KEY);
    return raw ? (JSON.parse(raw) as SocialSignal[]) : [];
  } catch {
    return [];
  }
}

async function loadSeenIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

async function saveSeenIds(seen: Set<string>): Promise<void> {
  const arr = Array.from(seen).slice(-MAX_SEEN);
  await AsyncStorage.setItem(SEEN_KEY, JSON.stringify(arr));
}

type SocialListener = (newSignals: SocialSignal[]) => void;
let socialListener: SocialListener | null = null;

/** شنونده سیگنال‌های جدید (AppContext → نوتیفیکیشن محلی). */
export function setSocialSignalsUpdateListener(cb: SocialListener | null): void {
  socialListener = cb;
}

/** تنظیمات نمایش منبع — پیش‌فرض هر دو خاموش (طبق درخواست کاربر). */
export async function loadSocialDisplayFlags(): Promise<{ showSourceName: boolean; showLink: boolean }> {
  try {
    const raw = await AsyncStorage.getItem(TELEGRAM_SETTINGS_KEY);
    const s = raw ? JSON.parse(raw) : {};
    return {
      showSourceName: s.socialShowSourceName === true,
      showLink: s.socialShowSourceLink === true,
    };
  } catch {
    return { showSourceName: false, showLink: false };
  }
}

async function maybeAnnounceToTelegram(sig: SocialSignal): Promise<void> {
  try {
    // فقط وقتی تلگرام در تنظیمات برنامه فعال است — بدون هیچ سروری، مستقیم از گوشی.
    const raw = await AsyncStorage.getItem(TELEGRAM_SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as {
      telegramEnabled?: boolean;
      telegramBotToken?: string;
      telegramChatId?: string;
    };
    if (!s.telegramEnabled || !s.telegramBotToken || !s.telegramChatId) return;
    const { sendTelegramSocialSignal } = await import('./telegramService');
    await sendTelegramSocialSignal(sig, {
      botToken: s.telegramBotToken,
      chatId: s.telegramChatId,
      showUsername: (await loadSocialDisplayFlags()).showSourceName,
      showLink: (await loadSocialDisplayFlags()).showLink,
    });
  } catch (e) {
    console.log('[SocialSignals] تلگرام ارسال نشد:', (e as Error).message);
  }
}

export interface SocialCycleResult {
  newSignals: SocialSignal[];
  fetchedTweets: number;
  errors: string[];
  ok: boolean;
}

let cycleRunning = false;

/** یک دور کامل: همه منابع → توییت‌ها → فیلتر → سیگنال جدید → تلگرام/شنونده. */
export async function runSocialSignalsCycle(): Promise<SocialCycleResult> {
  if (cycleRunning) return { newSignals: [], fetchedTweets: 0, errors: ['چرخه قبلی هنوز در حال اجراست'], ok: false };
  cycleRunning = true;
  try {
    const sources = await listSocialSources();
    const seen = await loadSeenIds();
    const stored = await loadSocialSignals();
    const storedIds = new Set(stored.map((s) => s.id));

    const fresh: SocialSignal[] = [];
    const errors: string[] = [];
    let fetched = 0;

    for (const src of sources) {
      try {
        const rss = await fetchUserRss(src.user);
        if (!rss) {
          errors.push(`@${src.user}: هیچ گیت‌وی پاسخ نداد`);
          continue;
        }
        const tweets = parseRss(rss);
        fetched += tweets.length;
        for (const tw of tweets) {
          if (seen.has(tw.id) || storedIds.has(tw.id)) continue;
          const sig = toValidSignal(tw);
          if (!sig) continue; // بدون چارت یا بدون $تیکر → کلاً نمایش داده نمی‌شود
          fresh.push(sig);
        }
      } catch (e) {
        errors.push(`@${src.user}: ${(e as Error).message}`);
      }
    }

    if (fresh.length > 0) {
      // تازه‌ها اول (بر اساس زمان انتشار)
      fresh.sort((a, b) => b.publishedAt - a.publishedAt);
      const merged = [...fresh, ...stored.filter((s) => !fresh.some((f) => f.id === s.id))].slice(0, MAX_SIGNALS);
      await AsyncStorage.setItem(SIGNALS_KEY, JSON.stringify(merged));
      for (const f of fresh) seen.add(f.id);
      await saveSeenIds(seen);

      // اعلان تلگرام (بدون سرور — مستقیم از گوشی) + شنونده محلی
      for (const sig of fresh) {
        await maybeAnnounceToTelegram(sig);
      }
      try {
        socialListener?.(fresh);
      } catch {}
    }

    return { newSignals: fresh, fetchedTweets: fetched, errors, ok: errors.length < sources.length };
  } finally {
    cycleRunning = false;
  }
}

// ---------------------------------------------------------------------------
// اسکجولر — بازه بروزرسانی طبق تنظیمات برنامه (refreshInterval دقیقه)
// ---------------------------------------------------------------------------

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let schedulerMinutes = 0;

export function startSocialSignalsScheduler(intervalMinutes: number): void {
  if (Platform.OS === 'web') return;
  const mins = Math.max(1, Math.round(intervalMinutes || 5));
  if (schedulerInterval && schedulerMinutes === mins) return;
  stopSocialSignalsScheduler();
  schedulerMinutes = mins;
  console.log(`[SocialSignals] اسکجولر هر ${mins} دقیقه شروع شد`);
  // اولین چرخه کمی بعد از استارت برنامه (تا بلوکه شدن UI اولیه نشود)
  setTimeout(() => {
    runSocialSignalsCycle().catch((e) => console.log('[SocialSignals] چرخه اول:', (e as Error).message));
  }, 4000);
  schedulerInterval = setInterval(() => {
    runSocialSignalsCycle().catch((e) => console.log('[SocialSignals] چرخه:', (e as Error).message));
  }, mins * 60_000);
}

export function stopSocialSignalsScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    schedulerMinutes = 0;
  }
}

/** نوتیفیکیشن محلی برای سیگنال‌های جدید (وقتی برنامه باز/زمینه است). */
export async function notifySocialSignalsLocal(signals: SocialSignal[]): Promise<void> {
  if (Platform.OS === 'web') return;
  for (const sig of signals.slice(0, 4)) {
    const tag = sig.tickers.map((t) => `$${t}`).join(' ');
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `🔵 سیگنال سوشال‌مدیا — ${tag}`,
          body: sig.text.length > 120 ? `${sig.text.slice(0, 117)}…` : sig.text,
          sound: 'default',
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1 },
      });
    } catch {}
  }
}

/** برای بک‌فچ پس‌زمینه — گیت‌وی سالم فعلی (لاگ/تشخیص). */
export function currentGoodGateway(): string | null {
  return cachedGoodGateway;
}

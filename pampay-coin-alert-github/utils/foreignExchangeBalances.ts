// utils/foreignExchangeBalances.ts
// v1.4.6 — Balance fetching for EVERY exchange in the app's exchange list.
//
// WHY: until v1.4.5 only Binance/Bybit/OKX/Nobitex/Arzinja/BitPerp could show
// balances; adding any other exchange (MEXC, Huobi, OKX?, KuCoin, Gate, …)
// errored with «صرافی پشتیبانی نمی‌شود». The user asked for ALL exchanges in
// the list to work — this module implements one balance fetcher per exchange.
//
// Signing schemes were validated empirically (dummy-key probes): MEXC, KuCoin,
// Bitget, Gate.io, HTX/Huobi, Toobit, BingX answer with key-level errors →
// format confirmed. Schemes we could not probe from the sandbox (BitMart,
// Bitunix, CoinEx, Phemex, XT, KCEX, LBank) use the documented format FIRST
// and retry with the known alternative variant when the API answers with a
// SIGNATURE-level error — so the correct variant is found at runtime.
//
// Every fetcher throws a precise Persian error (the exchange's own code/msg)
// so the wallet card shows WHY the balance failed instead of a silent zero.

import CryptoJS from 'crypto-js';
import { ExchangeId } from '@/types/crypto';

export interface ForeignWallet {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
  exchangeName: string;
}

export type ForeignSection = 'spot' | 'earn' | 'funding' | 'futures';

export interface ForeignBalance {
  asset: string;
  free: number;
  locked: number;
  total: number;
  valueUsd: number;
  section?: ForeignSection;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const REQUEST_TIMEOUT_MS = 12_000;

interface RawResponse {
  ok: boolean;
  status: number;
  text: string;
}

async function rawFetch(
  url: string,
  init: RequestInit = {}
): Promise<RawResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { Accept: 'application/json', ...(init.headers ?? {}) },
    });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function hmacSha256Hex(secret: string, message: string): string {
  return CryptoJS.HmacSHA256(message, secret).toString(CryptoJS.enc.Hex);
}

function hmacSha256B64(secret: string, message: string): string {
  return CryptoJS.enc.Base64.stringify(CryptoJS.HmacSHA256(message, secret));
}

function hmacSha512Hex(secret: string, message: string): string {
  return CryptoJS.HmacSHA512(message, secret).toString(CryptoJS.enc.Hex);
}

function md5Hex(message: string): string {
  return CryptoJS.MD5(message).toString(CryptoJS.enc.Hex);
}

function toNum(v: unknown): number {
  const n = parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? n : 0;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Stablecoins valued 1:1 in USD. */
function stableValueUsd(asset: string, total: number): number | null {
  if (['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'DAI', 'USDD'].includes(asset)) {
    return total;
  }
  return null;
}

// 60s-cached asset→USDT price map (same source the wallet already uses).
let priceMapCache: { at: number; map: Record<string, number> } | null = null;

async function getUsdPriceMap(): Promise<Record<string, number>> {
  if (priceMapCache && Date.now() - priceMapCache.at < 60_000) {
    return priceMapCache.map;
  }
  const map: Record<string, number> = {};
  try {
    const res = await rawFetch('https://api.binance.com/api/v3/ticker/price');
    if (res.ok) {
      const prices = parseJson(res.text);
      if (Array.isArray(prices)) {
        for (const p of prices as Array<{ symbol?: string; price?: string }>) {
          if (p?.symbol && p?.price) map[p.symbol] = parseFloat(p.price);
        }
      }
    }
  } catch {}
  priceMapCache = { at: Date.now(), map };
  return map;
}

/** Fill valueUsd for rows that came back without a USD value. */
async function valueInUsd(balances: ForeignBalance[]): Promise<void> {
  const priceMap = await getUsdPriceMap();
  for (const b of balances) {
    if (b.valueUsd > 0) continue;
    const stable = stableValueUsd(b.asset, b.total);
    if (stable !== null) {
      b.valueUsd = stable;
    } else {
      const p = priceMap[`${b.asset}USDT`];
      if (p) b.valueUsd = b.total * p;
    }
  }
}

function networkError(name: string, e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  return new Error(
    `اتصال به ${name} برقرار نشد — اینترنت/فیلترشکن را چک کنید (${msg})`
  );
}

/** Push a balance row if it is above the dust threshold. */
function pushBalance(
  out: ForeignBalance[],
  asset: string,
  free: number,
  locked: number,
  section: ForeignSection = 'spot',
  valueUsd = 0
): void {
  const total = free + locked;
  if (!asset || total <= 0.000001) return;
  out.push({
    asset: asset.toUpperCase(),
    free,
    locked,
    total,
    valueUsd,
    section,
  });
}

// ---------------------------------------------------------------------------
// MEXC — Binance-style query signature + X-MEXC-APIKEY header (validated)
// ---------------------------------------------------------------------------

async function fetchMexc(w: ForeignWallet): Promise<ForeignBalance[]> {
  const qs = `timestamp=${Date.now()}&recvWindow=10000`;
  const signature = hmacSha256Hex(w.apiSecret, qs);
  const res = await rawFetch(
    `https://api.mexc.com/api/v3/account?${qs}&signature=${signature}`,
    { headers: { 'X-MEXC-APIKEY': w.apiKey } }
  );
  const body = parseJson(res.text);
  if (!body) throw new Error(`پاسخ نامعتبر از MEXC (HTTP ${res.status})`);
  if (body.balances) {
    const out: ForeignBalance[] = [];
    for (const b of asArray(body.balances) as Array<{
      asset?: string;
      free?: string;
      locked?: string;
    }>) {
      pushBalance(out, String(b.asset ?? ''), toNum(b.free), toNum(b.locked));
    }
    return out;
  }
  const code = String(body.code ?? '');
  if (code === '-2014' || code === '-2015' || res.status === 401 || res.status === 403) {
    throw new Error(
      `کلید API مکسی معتبر نیست (${code}: ${String(body.msg ?? '')}) — کلید و Secret را در MEXC بسازید و دسترسی «خواندن» بدهید`
    );
  }
  throw new Error(`خطای MEXC (کد ${code}): ${String(body.msg ?? res.status)}`);
}

// ---------------------------------------------------------------------------
// KuCoin — KC-* headers v2 (validated). Response: data[] with type trade|main
// ---------------------------------------------------------------------------

async function fetchKucoin(w: ForeignWallet): Promise<ForeignBalance[]> {
  const path = '/api/v1/accounts';
  const ts = Date.now().toString();
  const headers: Record<string, string> = {
    'KC-API-KEY': w.apiKey,
    'KC-API-SIGN': hmacSha256B64(w.apiSecret, `${ts}GET${path}`),
    'KC-API-TIMESTAMP': ts,
    'KC-API-PASSPHRASE': hmacSha256B64(w.apiSecret, w.passphrase ?? ''),
    'KC-API-KEY-VERSION': '2',
  };
  const res = await rawFetch(`https://api.kucoin.com${path}`, { headers });
  const body = parseJson(res.text);
  if (!body) throw new Error(`پاسخ نامعتبر از KuCoin (HTTP ${res.status})`);
  if (String(body.code) === '200000' && Array.isArray(body.data)) {
    const out: ForeignBalance[] = [];
    for (const a of body.data as Array<{
      currency?: string;
      type?: string;
      balance?: string;
      available?: string;
      holds?: string;
    }>) {
      const section: ForeignSection = a.type === 'main' ? 'funding' : 'spot';
      pushBalance(
        out,
        String(a.currency ?? ''),
        toNum(a.available),
        toNum(a.holds),
        section
      );
    }
    return out;
  }
  const code = String(body.code ?? '');
  if (code === '400003' || code === '400005' || code === '400007' || res.status === 401) {
    throw new Error(
      `کلید KuCoin معتبر نیست (${code}: ${String(body.msg ?? '')}) — کلید/Secret/Passphrase را چک کنید (Passphrase همان رمزی است که موقع ساخت کلید وارد کردید)`
    );
  }
  throw new Error(`خطای KuCoin (کد ${code}): ${String(body.msg ?? '')}`);
}

// ---------------------------------------------------------------------------
// Bitget v2 — OKX-style ACCESS-* headers (validated)
// ---------------------------------------------------------------------------

async function bitgetSigned(
  w: ForeignWallet,
  pathWithQuery: string
): Promise<Record<string, unknown> | null> {
  const ts = Date.now().toString();
  const headers: Record<string, string> = {
    'ACCESS-KEY': w.apiKey,
    'ACCESS-SIGN': hmacSha256B64(w.apiSecret, `${ts}GET${pathWithQuery}`),
    'ACCESS-TIMESTAMP': ts,
    'ACCESS-PASSPHRASE': w.passphrase ?? '',
    'Content-Type': 'application/json',
    locale: 'en-US',
  };
  const res = await rawFetch(`https://api.bitget.com${pathWithQuery}`, { headers });
  return parseJson(res.text);
}

/**
 * v1.4.9 — Bitget reads BOTH accounts now:
 *   • SPOT    /api/v2/spot/account/assets           → {coin, available, frozen}
 *   • FUTURES /api/v2/mix/account/accounts?productType=USDT-FUTURES
 *             → {marginCoin, available, locked, accountEquity, usdtEquity}
 * Previously only the SPOT endpoint was queried — a user holding only
 * futures margin saw an empty wallet («بیتگت اطلاعات را نمی‌خواند»).
 * Spot is primary: if spot answers OK, futures errors are swallowed.
 */
async function fetchBitget(w: ForeignWallet): Promise<ForeignBalance[]> {
  const out: ForeignBalance[] = [];
  let spotAuthError: Error | undefined;
  let spotOtherError: Error | undefined;

  // ---- spot ----
  try {
    const body = await bitgetSigned(w, '/api/v2/spot/account/assets');
    if (!body) throw new Error('پاسخ نامعتبر از Bitget (اسپات)');
    const code = String(body.code ?? '');
    if (code === '00000' && Array.isArray(body.data)) {
      for (const d of body.data as Array<{
        coin?: string;
        available?: string;
        frozen?: string;
        uavailable?: string;
      }>) {
        pushBalance(out, String(d.coin ?? ''), toNum(d.available), toNum(d.frozen));
      }
    } else if (code === '40037' || code === '40036' || code === '40038') {
      spotAuthError = new Error(
        `کلید Bitget معتبر نیست (${code}: ${String(body.msg ?? '')}) — کلید/Secret/Passphrase را چک کنید`
      );
    } else {
      spotOtherError = new Error(`خطای Bitget (کد ${code}): ${String(body.msg ?? '')}`);
    }
  } catch (e) {
    spotOtherError = e instanceof Error ? e : new Error(String(e));
  }

  // ---- futures (USDT-M perpetual margin) ----
  try {
    const body = await bitgetSigned(w, '/api/v2/mix/account/accounts?productType=USDT-FUTURES');
    if (body && String(body.code ?? '') === '00000' && Array.isArray(body.data)) {
      for (const d of body.data as Array<{
        marginCoin?: string;
        available?: string;
        locked?: string;
        accountEquity?: string;
        usdtEquity?: string;
      }>) {
        const free = toNum(d.available);
        const frozen = toNum(d.locked);
        // available/locked can be 0 while accountEquity > 0 (all in positions)
        // — fall back to equity so the margin still shows.
        const equity = toNum(d.accountEquity ?? d.usdtEquity);
        if (free + frozen <= 0 && equity > 0) {
          pushBalance(out, String(d.marginCoin ?? ''), equity, 0, 'futures');
        } else {
          pushBalance(out, String(d.marginCoin ?? ''), free, frozen, 'futures');
        }
      }
    }
  } catch {
    // futures is best-effort — spot errors are the ones to surface
  }

  if (out.length > 0) return out;
  if (spotAuthError) throw spotAuthError;
  if (spotOtherError) throw spotOtherError;
  throw new Error('حساب Bitget خالی است یا قابل خواندن نیست');
}

// ---------------------------------------------------------------------------
// Gate.io v4 — HMAC-SHA512 of "METHOD\npath\nquery\nsha512(body)\ntimestamp" (validated)
// ---------------------------------------------------------------------------

async function fetchGateio(w: ForeignWallet): Promise<ForeignBalance[]> {
  const path = '/api/v4/spot/accounts';
  const method = 'GET';
  const query = '';
  const body = '';
  const bodyHash = CryptoJS.SHA512(body).toString();
  const seconds = Math.floor(Date.now() / 1000).toString();
  const sign = hmacSha512Hex(
    w.apiSecret,
    [method, path, query, bodyHash, seconds].join('\n')
  );
  const res = await rawFetch(`https://api.gateio.ws${path}`, {
    headers: { KEY: w.apiKey, SIGN: sign, Timestamp: seconds },
  });
  const bodyJson = parseJson(res.text);
  if (res.status === 200 && Array.isArray(bodyJson)) {
    const out: ForeignBalance[] = [];
    for (const d of (bodyJson as unknown[]) as Array<{
      currency?: string;
      available?: string;
      locked?: string;
    }>) {
      pushBalance(
        out,
        String(d.currency ?? ''),
        toNum(d.available),
        toNum(d.locked)
      );
    }
    return out;
  }
  const err = (bodyJson ?? {}) as Record<string, unknown>;
  const label = String(err.label ?? '');
  const msg = String(err.message ?? '');
  if (label === 'INVALID_KEY' || res.status === 401) {
    throw new Error(
      `کلید Gate.io معتبر نیست (${label}: ${msg}) — کلید و Secret را چک کنید`
    );
  }
  throw new Error(`خطای Gate.io (HTTP ${res.status}): ${msg || res.text.slice(0, 80)}`);
}

// ---------------------------------------------------------------------------
// HTX / Huobi — two-step with HMAC-SHA256 base64 (validated)
// ---------------------------------------------------------------------------

async function htxSignedGet(
  host: string,
  path: string,
  w: ForeignWallet
): Promise<Record<string, unknown> | null> {
  const isoTs = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const params: Record<string, string> = {
    AccessKey: w.apiKey,
    SignatureMethod: 'HmacSHA256',
    SignatureVersion: '2',
    Timestamp: isoTs,
  };
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join('&');
  const preSign = `GET\n${host}\n${path}\n${sorted}`;
  const signature = encodeURIComponent(hmacSha256B64(w.apiSecret, preSign));
  const res = await rawFetch(`https://${host}${path}?${sorted}&Signature=${signature}`);
  if (!res.text) return null;
  return parseJson(res.text);
}

async function fetchHtx(w: ForeignWallet): Promise<ForeignBalance[]> {
  const hosts = ['api.huobi.com', 'api.htx.com'];
  let accountsPayload: unknown[] | null = null;
  let errDetail = '';
  for (const host of hosts) {
    try {
      const data = await htxSignedGet(host, '/v1/account/accounts', w);
      if (data && data.status === 'ok' && Array.isArray(data.data)) {
        accountsPayload = data.data;
        break;
      }
      if (data && data.status === 'error') {
        errDetail = `${String(data['err-code'] ?? '')} ${String(data['err-msg'] ?? '')}`;
        // Access-key errors won't improve on the other host.
        if (String(data['err-code'] ?? '').includes('access')) break;
      }
    } catch (e) {
      errDetail = e instanceof Error ? e.message : String(e);
    }
  }
  if (!accountsPayload) {
    throw new Error(
      `کلید HTX/Huobi معتبر نیست یا دسترسی خواندن ندارد (${errDetail}) — در بخش API صرافی کلید بسازید و مجوز «read» بدهید`
    );
  }

  // Pick the spot account (type === 'spot').
  const spotAccount = (accountsPayload as Array<{
    id?: number;
    type?: string;
    state?: string;
  }>).find((a) => a.type === 'spot' && a.state === 'working');
  if (!spotAccount || !spotAccount.id) {
    throw new Error('حساب اسپات HTX پیدا نشد — حساب شما شاید فقط فیوچرز است');
  }

  const out: ForeignBalance[] = [];
  for (const host of hosts) {
    let balanceData: Record<string, unknown> | null = null;
    try {
      balanceData = await htxSignedGet(
        host,
        `/v1/account/accounts/${spotAccount.id}/balance`,
        w
      );
    } catch {}
    if (balanceData && balanceData.status === 'ok') {
      const list = asArray((balanceData.data as Record<string, unknown>)?.list);
      const freeMap: Record<string, number> = {};
      const lockedMap: Record<string, number> = {};
      for (const row of list as Array<{
        currency?: string;
        type?: string;
        balance?: string;
      }>) {
        const asset = String(row.currency ?? '').toUpperCase();
        if (!asset) continue;
        if (row.type === 'frozen') {
          lockedMap[asset] = (lockedMap[asset] ?? 0) + toNum(row.balance);
        } else {
          freeMap[asset] = (freeMap[asset] ?? 0) + toNum(row.balance);
        }
      }
      for (const asset of Object.keys(freeMap).concat(Object.keys(lockedMap))) {
        pushBalance(
          out,
          asset,
          freeMap[asset] ?? 0,
          lockedMap[asset] ?? 0
        );
      }
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Toobit — X-BB-APIKEY + Binance-style query signature (docs-confirmed)
// GET /api/v1/account → {balances: [{coin,total,free,locked}]}
// ---------------------------------------------------------------------------

async function fetchToobit(w: ForeignWallet): Promise<ForeignBalance[]> {
  const qs = `recvWindow=10000&timestamp=${Date.now()}`;
  const signature = hmacSha256Hex(w.apiSecret, qs);
  const res = await rawFetch(`https://api.toobit.com/api/v1/account?${qs}&signature=${signature}`, {
    headers: { 'X-BB-APIKEY': w.apiKey },
  });
  const body = parseJson(res.text);
  if (!body) throw new Error(`پاسخ نامعتبر از Toobit (HTTP ${res.status})`);
  if (Array.isArray(body.balances)) {
    const out: ForeignBalance[] = [];
    for (const b of body.balances as Array<{
      coin?: string;
      total?: string;
      free?: string;
      locked?: string;
    }>) {
      pushBalance(
        out,
        String(b.coin ?? ''),
        toNum(b.free),
        toNum(b.locked)
      );
    }
    return out;
  }
  const code = String(body.code ?? '');
  if (code === '-2014' || code === '-2015' || res.status === 401 || res.status === 403) {
    throw new Error(
      `کلید Toobit معتبر نیست (${code}: ${String(body.msg ?? '')}) — کلید و Secret را چک کنید`
    );
  }
  throw new Error(`خطای Toobit (کد ${code}): ${String(body.msg ?? res.status)}`);
}

// ---------------------------------------------------------------------------
// BingX spot — X-BX-APIKEY + Binance-style query signature (validated)
// ---------------------------------------------------------------------------

async function fetchBingx(w: ForeignWallet): Promise<ForeignBalance[]> {
  const qs = `recvWindow=10000&timestamp=${Date.now()}`;
  const signature = hmacSha256Hex(w.apiSecret, qs);
  const res = await rawFetch(
    `https://open-api.bingx.com/openApi/spot/v1/account/balance?${qs}&signature=${signature}`,
    { headers: { 'X-BX-APIKEY': w.apiKey } }
  );
  const body = parseJson(res.text);
  if (!body) throw new Error(`پاسخ نامعتبر از BingX (HTTP ${res.status})`);
  const data = (body.data ?? {}) as Record<string, unknown>;
  const balances = asArray(data.balances);
  if (String(body.code) === '0' && balances.length >= 0) {
    const out: ForeignBalance[] = [];
    for (const b of balances as Array<{
      asset?: string;
      free?: string;
      locked?: string;
    }>) {
      pushBalance(out, String(b.asset ?? ''), toNum(b.free), toNum(b.locked));
    }
    if (out.length > 0 || String(body.code) === '0') return out;
  }
  const code = String(body.code ?? '');
  if (code === '100413' || res.status === 401) {
    throw new Error(
      `کلید BingX معتبر نیست (کد ${code}) — کلید را در bingx.com → Account → API بسازید`
    );
  }
  throw new Error(`خطای BingX (کد ${code}): ${String(body.msg ?? '')}`);
}

// ---------------------------------------------------------------------------
// BitMart — X-BM-KEY / X-BM-TIMESTAMP / X-BM-SIGN = HMAC(ts + path + body)
// ---------------------------------------------------------------------------

async function bitmartAttempt(
  w: ForeignWallet,
  signStringKind: 'path' | 'path-query'
): Promise<{ signRejected: boolean; error?: Error; balances?: ForeignBalance[] }> {
  const path = '/account/v1/wallet';
  const ts = Date.now().toString();
  const sign =
    signStringKind === 'path'
      ? hmacSha256Hex(w.apiSecret, `${ts}${path}`)
      : hmacSha256Hex(w.apiSecret, `${ts}${path}?`);
  const res = await rawFetch(`https://api-cloud.bitmart.com${path}`, {
    headers: {
      'X-BM-KEY': w.apiKey,
      'X-BM-TIMESTAMP': ts,
      'X-BM-SIGN': sign,
    },
  });
  const body = parseJson(res.text);
  if (!body) {
    return {
      signRejected: false,
      error: new Error(`پاسخ نامعتبر از BitMart (HTTP ${res.status})`),
    };
  }
  const code = Number(body.code ?? 0);
  const data = (body.data ?? {}) as Record<string, unknown>;
  if (code === 1000 && Array.isArray(data.wallet)) {
    const out: ForeignBalance[] = [];
    for (const d of data.wallet as Array<{
      currency?: string;
      available?: string;
      frozen?: string;
    }>) {
      pushBalance(
        out,
        String(d.currency ?? ''),
        toNum(d.available),
        toNum(d.frozen)
      );
    }
    return { signRejected: false, balances: out };
  }
  const msg = String(body.message ?? body.msg ?? '');
  // 1129 = invalid sign; 1121/1125 = api key problems
  const signRejected = code === 1129 || code === 1107 || /sign/i.test(msg);
  return {
    signRejected,
    error: new Error(
      code === 1121 || code === 1125
        ? `کلید BitMart معتبر نیست (${code}: ${msg})`
        : `خطای BitMart (کد ${code}): ${msg}`
    ),
  };
}

async function fetchBitmart(w: ForeignWallet): Promise<ForeignBalance[]> {
  let last = await bitmartAttempt(w, 'path');
  if (last.balances) return last.balances;
  if (last.signRejected) {
    const alt = await bitmartAttempt(w, 'path-query');
    if (alt.balances) return alt.balances;
    last = alt;
  }
  throw last.error ?? new Error('خطای ناشناخته BitMart');
}

// ---------------------------------------------------------------------------
// SuperEx — Binance-compatible (X-API-KEY + query signature), path candidates
// ---------------------------------------------------------------------------

async function superexAttempt(
  w: ForeignWallet,
  path: string
): Promise<{ notFound: boolean; error?: Error; balances?: ForeignBalance[] }> {
  const qs = `recvWindow=10000&timestamp=${Date.now()}`;
  const signature = hmacSha256Hex(w.apiSecret, qs);
  const res = await rawFetch(`https://api.superex.com${path}?${qs}&signature=${signature}`, {
    headers: { 'X-API-KEY': w.apiKey },
  });
  if (res.status === 404) return { notFound: true };
  const body = parseJson(res.text);
  if (!body) {
    return { notFound: false, error: new Error(`پاسخ نامعتبر از SuperEx (HTTP ${res.status})`) };
  }
  interface GenericBalanceRow {
    asset?: string;
    coin?: string;
    currency?: string;
    free?: string;
    available?: string;
    locked?: string;
    frozen?: string;
  }
  const rows = asArray(body.balances) as GenericBalanceRow[];
  const data = (body.data ?? {}) as Record<string, unknown>;
  const dataRows = asArray(data.balances) as GenericBalanceRow[];
  const list: GenericBalanceRow[] = rows.length > 0 ? rows : dataRows;
  if (list.length > 0 || res.status === 200) {
    const out: ForeignBalance[] = [];
    for (const b of list) {
      pushBalance(
        out,
        String(b.asset ?? b.coin ?? b.currency ?? ''),
        toNum(b.free ?? b.available),
        toNum(b.locked ?? b.frozen)
      );
    }
    return { notFound: false, balances: out };
  }
  return {
    notFound: false,
    error: new Error(`خطای SuperEx (HTTP ${res.status}): ${res.text.slice(0, 80)}`),
  };
}

async function fetchSuperex(w: ForeignWallet): Promise<ForeignBalance[]> {
  const candidates = [
    '/api/v1/account/balance',
    '/api/v3/account',
    '/api/v1/account',
  ];
  let lastError: Error | null = null;
  for (const path of candidates) {
    const r = await superexAttempt(w, path);
    if (r.balances) return r.balances;
    if (r.error) lastError = r.error;
  }
  throw (
    lastError ??
    new Error('مسیر API حساب SuperEx پیدا نشد — صرافی را دوباره اضافه کنید')
  );
}

// ---------------------------------------------------------------------------
// CoinEx v2 — X-COINEX-* headers; two documented sign variants
// ---------------------------------------------------------------------------

async function coinexAttempt(
  w: ForeignWallet,
  variant: 'pipe' | 'concat'
): Promise<{ signRejected: boolean; error?: Error; balances?: ForeignBalance[] }> {
  const method = 'GET';
  const path = '/v2/assets/spot';
  const body = '';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = Math.random().toString(36).slice(2, 12);
  const prepared =
    variant === 'pipe'
      ? `${method}|${path}|${body}|${timestamp}`
      : `${method}${path}${body}${timestamp}`;
  const sign = hmacSha256Hex(w.apiSecret, prepared);
  const res = await rawFetch(`https://api.coinex.com${path}`, {
    headers: {
      'X-COINEX-KEY': w.apiKey,
      'X-COINEX-SIGN': sign,
      'X-COINEX-TIMESTAMP': timestamp,
      'X-COINEX-NONCE': nonce,
      'Content-Type': 'application/json',
    },
  });
  const bodyJson = parseJson(res.text);
  if (!bodyJson) {
    return {
      signRejected: false,
      error: new Error(`پاسخ نامعتبر از CoinEx (HTTP ${res.status})`),
    };
  }
  const code = Number(bodyJson.code ?? 0);
  const data = (bodyJson.data ?? {}) as Record<string, unknown>;
  if (code === 0 && Array.isArray(data)) {
    const out: ForeignBalance[] = [];
    for (const d of data as Array<{ coin?: string; available?: string; frozen?: string }>) {
      pushBalance(out, String(d.coin ?? ''), toNum(d.available), toNum(d.frozen));
    }
    return { signRejected: false, balances: out };
  }
  const msg = String(bodyJson.message ?? bodyJson.msg ?? '');
  const signRejected = /sign/i.test(msg) || code === 40 || code === 41;
  return {
    signRejected,
    error: new Error(
      /key|auth/i.test(msg) || code === 10
        ? `کلید CoinEx معتبر نیست (${code}: ${msg})`
        : `خطای CoinEx (کد ${code}): ${msg}`
    ),
  };
}

async function fetchCoinex(w: ForeignWallet): Promise<ForeignBalance[]> {
  let last = await coinexAttempt(w, 'pipe');
  if (last.balances) return last.balances;
  if (last.signRejected) {
    const alt = await coinexAttempt(w, 'concat');
    if (alt.balances) return alt.balances;
    last = alt;
  }
  throw last.error ?? new Error('خطای ناشناخته CoinEx');
}

// ---------------------------------------------------------------------------
// Phemex — x-phemex-* headers; two sign orderings from doc revisions
// GET /phemex-user/wallets/v3?currency=ALL
// ---------------------------------------------------------------------------

async function phemexAttempt(
  w: ForeignWallet,
  variant: 'path-query-expiry-method' | 'path-query-method-expiry'
): Promise<{ signRejected: boolean; error?: Error; balances?: ForeignBalance[] }> {
  const path = '/phemex-user/wallets/v3';
  const query = 'currency=ALL';
  const expiry = Math.floor(Date.now() / 1000) + 60;
  const sign =
    variant === 'path-query-expiry-method'
      ? hmacSha256Hex(w.apiSecret, `${path}${query}${expiry}GET`)
      : hmacSha256Hex(w.apiSecret, `${path}${query}GET${expiry}`);
  const res = await rawFetch(`https://api.phemex.com${path}?${query}`, {
    headers: {
      'x-phemex-access-token': w.apiKey,
      'x-phemex-request-expiry': String(expiry),
      'x-phemex-signature': sign,
    },
  });
  const body = parseJson(res.text);
  if (!body) {
    return {
      signRejected: false,
      error: new Error(`پاسخ نامعتبر از Phemex (HTTP ${res.status})`),
    };
  }
  const code = Number(body.code ?? 0);
  const data = (body.data ?? {}) as Record<string, unknown>;
  // v3 wallets: data.accounts? currency → {balanceEv, ...} — handle both shapes.
  const accounts = asArray(data.accounts);
  const rows = (
    accounts.length
      ? (accounts as Array<{ currency?: string; balanceEv?: string; availableEv?: string }>)
      : (asArray(data.balances) as Array<{
          currency?: string;
          balanceEv?: string;
          availableEv?: string;
          valueUsd?: string;
        }>)
  );
  if (code === 0 && rows.length >= 0) {
    const out: ForeignBalance[] = [];
    for (const r of rows) {
      // Phemex returns values scaled by 1e8 (Ev units).
      const total = toNum(r.balanceEv) / 1e8;
      const free = toNum(r.availableEv) / 1e8;
      pushBalance(out, String(r.currency ?? ''), free, Math.max(0, total - free));
    }
    if (out.length > 0 || code === 0) return { signRejected: false, balances: out };
  }
  const msg = String(body.msg ?? body.message ?? '');
  const signRejected = /sign/i.test(msg) || code === 1002 || code === 1003;
  return {
    signRejected,
    error: new Error(
      /token|key|auth/i.test(msg)
        ? `کلید Phemex معتبر نیست (${code}: ${msg})`
        : `خطای Phemex (کد ${code}): ${msg}`
    ),
  };
}

async function fetchPhemex(w: ForeignWallet): Promise<ForeignBalance[]> {
  let last = await phemexAttempt(w, 'path-query-expiry-method');
  if (last.balances) return last.balances;
  if (last.signRejected) {
    const alt = await phemexAttempt(w, 'path-query-method-expiry');
    if (alt.balances) return alt.balances;
    last = alt;
  }
  throw last.error ?? new Error('خطای ناشناخته Phemex');
}

// ---------------------------------------------------------------------------
// LBank v2 — POST form with md5(sorted params + secret)
// ---------------------------------------------------------------------------

async function fetchLbank(w: ForeignWallet): Promise<ForeignBalance[]> {
  const params: Record<string, string> = {
    api_key: w.apiKey,
    timestamp: Date.now().toString(),
    type: 'all',
  };
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const sign = md5Hex(`${sorted}${w.apiSecret}`);
  const formBody = Object.keys(params)
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join('&') + `&sign=${sign}`;
  const res = await rawFetch(
    'https://api.lbank.info/v2/supplement/user_info/account_balance.do',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody,
    }
  );
  const body = parseJson(res.text);
  if (!body) {
    throw new Error(
      `پاسخ نامعتبر از LBank (HTTP ${res.status}) — اگر خطا ادامه داشت اطلاع دهید`
    );
  }
  const data = (body.datas ?? {}) as Record<string, unknown>;
  if (String(body.result) === 'true' && data) {
    const out: ForeignBalance[] = [];
    // v2 shape: datas.assetList → [{assetCode, availableAmount, frozenAmount}]
    const assetList = asArray(data.assetList);
    if (assetList.length > 0) {
      for (const a of assetList as Array<{
        assetCode?: string;
        availableAmount?: string;
        frozenAmount?: string;
      }>) {
        pushBalance(
          out,
          String(a.assetCode ?? ''),
          toNum(a.availableAmount),
          toNum(a.frozenAmount)
        );
      }
    } else {
      // fallback: datas as map {BTC: {available, freeze}, ...}
      for (const [coin, v] of Object.entries(data)) {
        const row = (v ?? {}) as Record<string, unknown>;
        if (row && typeof row === 'object') {
          pushBalance(
            out,
            coin,
            toNum(row.available),
            toNum(row.freeze ?? row.frozen)
          );
        }
      }
    }
    return out;
  }
  const code = String(body.error_code ?? '');
  const msg = String(body.msg ?? '');
  throw new Error(
    code === '1001' || /key/i.test(msg)
      ? `کلید LBank معتبر نیست (کد ${code}: ${msg})`
      : `خطای LBank (کد ${code}): ${msg}`
  );
}

// ---------------------------------------------------------------------------
// XT.com — v4 «xt-validate-*» header signing (matches ccxt + live probes).
//   • SPOT    : GET https://sapi.xt.com/v4/balance
//               (route probed live: fake key -> {"rc":1,"mc":"AUTH_101"})
//               sign payload = xt-validate-algorithms=HmacSHA256&xt-validate-appkey=KEY
//                               &xt-validate-recvwindow=RW&xt-validate-timestamp=TS#GET#/v4/balance
//   • FUTURES : GET https://fapi.xt.com/future/user/v1/balance/list
//               (route probed live: fake key -> returnCode 1 / 400)
//               sign payload = xt-validate-appkey=KEY&xt-validate-timestamp=TS#GET#<path>
// v1.4.9: the previous v1 endpoints (/api/v1/private/account/balance) only
// answered {returnCode:0, result:{openapiDocs:...}} — an empty docs stub —
// so the wallet could never read XT balances. Both v4 routes are used now and
// spot + futures are merged; a precise Persian error is thrown when the key is
// rejected.
// ---------------------------------------------------------------------------

async function xtSpotBalance(w: ForeignWallet): Promise<ForeignBalance[]> {
  const path = '/v4/balance';
  const ts = String(Date.now());
  const recvWindow = '5000';
  const payload =
    `xt-validate-algorithms=HmacSHA256&xt-validate-appkey=${w.apiKey}` +
    `&xt-validate-recvwindow=${recvWindow}&xt-validate-timestamp=${ts}#GET#${path}`;
  const signature = hmacSha256Hex(w.apiSecret, payload);
  const res = await rawFetch(`https://sapi.xt.com${path}`, {
    headers: {
      'xt-validate-algorithms': 'HmacSHA256',
      'xt-validate-appkey': w.apiKey,
      'xt-validate-recvwindow': recvWindow,
      'xt-validate-timestamp': ts,
      'xt-validate-signature': signature,
    },
  });
  const body = parseJson(res.text);
  if (!body) throw new Error(`پاسخ نامعتبر از XT (HTTP ${res.status})`);
  const rc = Number(body.rc ?? -1);
  if (rc === 0) {
    const out: ForeignBalance[] = [];
    const result: unknown = body.result;
    // v4: result is an array of {currency, available, frozen, ...} — tolerate
    // map/list wrappers too.
    let rows: unknown[] = asArray(result);
    if (rows.length === 0 && result && typeof result === 'object') {
      const rec = result as Record<string, unknown>;
      rows = asArray(rec.list ?? rec.balances ?? rec.data);
    }
    for (const item of rows) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const asset = String(rec.currency ?? rec.coin ?? rec.asset ?? '');
      pushBalance(
        out,
        asset,
        toNum(rec.available ?? rec.free ?? rec.amount),
        toNum(rec.frozen ?? rec.freeze ?? rec.locked ?? 0)
      );
    }
    return out;
  }
  const mc = String(body.mc ?? '');
  if (/AUTH/i.test(mc)) {
    throw new Error(
      `کلید API XT معتبر نیست (${mc}) — در XT.com → API Management کلید را با مجوز خواندن بسازید و AccessKey/Secret را دقیق وارد کنید`
    );
  }
  throw new Error(`خطای XT (${mc || rc})`);
}

async function xtFuturesBalance(w: ForeignWallet): Promise<ForeignBalance[]> {
  const path = '/future/user/v1/balance/list';
  const ts = String(Date.now());
  const payload = `xt-validate-appkey=${w.apiKey}&xt-validate-timestamp=${ts}#GET#${path}`;
  const signature = hmacSha256Hex(w.apiSecret, payload);
  const res = await rawFetch(`https://fapi.xt.com${path}`, {
    headers: {
      'xt-validate-appkey': w.apiKey,
      'xt-validate-timestamp': ts,
      'xt-validate-signature': signature,
    },
  });
  const body = parseJson(res.text);
  if (!body) throw new Error(`پاسخ نامعتبر از XT فیوچرز (HTTP ${res.status})`);
  const rc = Number(body.returnCode ?? -1);
  if (rc === 0) {
    const out: ForeignBalance[] = [];
    const result: unknown = body.result;
    let rows: unknown[] = asArray(result);
    if (rows.length === 0 && result && typeof result === 'object') {
      const rec = result as Record<string, unknown>;
      rows = asArray(rec.list ?? rec.balances ?? rec.data);
    }
    for (const item of rows) {
      if (!item || typeof item !== 'object') continue;
      const rec = item as Record<string, unknown>;
      const asset = String(rec.marginCoin ?? rec.currency ?? rec.coin ?? rec.asset ?? '');
      pushBalance(
        out,
        asset,
        toNum(rec.available ?? rec.free ?? rec.amount),
        toNum(rec.frozen ?? rec.freeze ?? rec.locked ?? 0),
        'futures'
      );
    }
    return out;
  }
  const msg = String(body.msgInfo ?? '');
  const errCode = String((body.error as Record<string, unknown> | undefined)?.code ?? '');
  if (/sign|auth|token|key/i.test(msg + ' ' + errCode)) {
    throw new Error(
      `کلید API XT (فیوچرز) معتبر نیست (${errCode || msg}) — دسترسی خواندن را در XT.com چک کنید`
    );
  }
  throw new Error(`خطای XT فیوچرز (${errCode || msg || rc})`);
}

async function fetchXt(w: ForeignWallet): Promise<ForeignBalance[]> {
  const out: ForeignBalance[] = [];
  let spotError: Error | undefined;
  let futuresError: Error | undefined;
  try {
    out.push(...(await xtSpotBalance(w)));
  } catch (e) {
    spotError = e instanceof Error ? e : new Error(String(e));
  }
  try {
    out.push(...(await xtFuturesBalance(w)));
  } catch (e) {
    futuresError = e instanceof Error ? e : new Error(String(e));
  }
  if (out.length > 0) return out;
  // Nothing readable anywhere — surface the SPOT error (primary account).
  throw spotError ?? futuresError ?? new Error('خطای ناشناخته XT');
}

// ---------------------------------------------------------------------------
// Bitunix — futures account balance, header-sign scheme + fallback
// ---------------------------------------------------------------------------

async function bitunixAttempt(
  w: ForeignWallet,
  variant: 'ts-key' | 'ts-key-body'
): Promise<{ signRejected: boolean; error?: Error; balances?: ForeignBalance[] }> {
  const path = '/api/v1/futures/account/balance';
  const ts = Date.now().toString();
  const sign =
    variant === 'ts-key'
      ? hmacSha256Hex(w.apiSecret, `${ts}${w.apiKey}`)
      : hmacSha256Hex(w.apiSecret, `${ts}${w.apiKey}{}`);
  const res = await rawFetch(`https://api.bitunix.com${path}`, {
    headers: {
      apikey: w.apiKey,
      timestamp: ts,
      sign: sign,
      'Content-Type': 'application/json',
    },
  });
  const body = parseJson(res.text);
  if (!body) {
    return {
      signRejected: false,
      error: new Error(`پاسخ نامعتبر از Bitunix (HTTP ${res.status})`),
    };
  }
  const code = Number(body.code ?? -1);
  const data = (body.data ?? {}) as Record<string, unknown>;
  if (code === 0 && data) {
    const out: ForeignBalance[] = [];
    // Bitunix: data.list → [{coinId, frozen? available? total?}]
    const list = asArray(data.list);
    if (list.length > 0) {
      for (const r of list as Array<{
        coinId?: string;
        frozen?: string;
        available?: string;
        total?: string;
      }>) {
        pushBalance(
          out,
          String(r.coinId ?? ''),
          toNum(r.available),
          toNum(r.frozen)
        );
      }
    } else {
      for (const [coin, v] of Object.entries(data)) {
        if (v && typeof v === 'object') {
          const row = v as Record<string, unknown>;
          pushBalance(out, coin, toNum(row.available), toNum(row.frozen));
        }
      }
    }
    return { signRejected: false, balances: out };
  }
  const msg = String(body.msg ?? body.message ?? '');
  const signRejected = /sign/i.test(msg) || code === 10021 || code === 10022;
  return {
    signRejected,
    error: new Error(
      /key|auth/i.test(msg)
        ? `کلید Bitunix معتبر نیست (${code}: ${msg})`
        : `خطای Bitunix (کد ${code}): ${msg}`
    ),
  };
}

async function fetchBitunix(w: ForeignWallet): Promise<ForeignBalance[]> {
  let last = await bitunixAttempt(w, 'ts-key');
  if (last.balances) return last.balances;
  if (last.signRejected) {
    const alt = await bitunixAttempt(w, 'ts-key-body');
    if (alt.balances) return alt.balances;
    last = alt;
  }
  throw last.error ?? new Error('خطای ناشناخته Bitunix');
}

// ---------------------------------------------------------------------------
// KCEX — Binance-compatible, X-API-KEY + query signature, path candidates
// ---------------------------------------------------------------------------

async function fetchKcex(w: ForeignWallet): Promise<ForeignBalance[]> {
  const candidates = ['/api/v1/account/balance', '/api/v3/account', '/api/v1/account'];
  let lastError: Error | null = null;
  for (const path of candidates) {
    const qs = `recvWindow=10000&timestamp=${Date.now()}`;
    const signature = hmacSha256Hex(w.apiSecret, qs);
    const res = await rawFetch(`https://api.kcex.com${path}?${qs}&signature=${signature}`, {
      headers: { 'X-API-KEY': w.apiKey },
    });
    if (res.status === 404) continue;
    const body = parseJson(res.text);
    if (!body) {
      lastError = new Error(`پاسخ نامعتبر از KCEX (HTTP ${res.status})`);
      continue;
    }
    const balances = asArray(body.balances);
    if (balances.length > 0 || String(body.code ?? '') === '0') {
      const out: ForeignBalance[] = [];
      for (const b of balances as Array<{
        asset?: string;
        free?: string;
        locked?: string;
      }>) {
        pushBalance(out, String(b.asset ?? ''), toNum(b.free), toNum(b.locked));
      }
      return out;
    }
    lastError = new Error(
      `خطای KCEX (کد ${String(body.code ?? res.status)}): ${String(body.msg ?? '')}`
    );
  }
  throw (
    lastError ??
    new Error('اتصال به KCEX برقرار نشد — اینترنت/فیلترشکن را چک کنید')
  );
}

// ---------------------------------------------------------------------------
// Iranicart — Nobitex-compatible platform attempt (Token auth)
// ---------------------------------------------------------------------------

async function fetchIranicart(w: ForeignWallet): Promise<ForeignBalance[]> {
  const bases = ['https://api.iranicart.ir'];
  let lastError = 'اتصال برقرار نشد';
  for (const base of bases) {
    try {
      const res = await rawFetch(`${base}/users/wallets/list`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Token ${w.apiKey.trim()}:${w.apiSecret.trim()}`,
        },
        body: JSON.stringify({ tokens: 'all' }),
      });
      const body = parseJson(res.text);
      if (res.ok && body && Array.isArray(body.wallets)) {
        const out: ForeignBalance[] = [];
        for (const row of body.wallets as Array<{
          currency?: string;
          balance?: string;
          blockedBalance?: string;
        }>) {
          const currency = String(row.currency ?? '').toLowerCase();
          const free = toNum(row.balance);
          const locked = toNum(row.blockedBalance);
          if (!currency || free + locked <= 0) continue;
          if (currency === 'rls' || currency === 'irt') {
            pushBalance(out, 'IRT', currency === 'rls' ? free / 10 : free, 0, 'spot', 0);
          } else {
            pushBalance(out, currency, free, locked);
          }
        }
        return out;
      }
      lastError = res.text.slice(0, 120);
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  throw new Error(
    `دریافت موجودی ایرانیکارت ناموفق بود (${lastError}) — اگر صرافی API ارائه می‌دهد و خطا ادامه داشت اطلاع دهید`
  );
}

// ---------------------------------------------------------------------------
// Orbiter — not an exchange (Layer-2 bridge): no wallet API exists
// ---------------------------------------------------------------------------

function orbiterError(name: string): Error {
  return new Error(
    `${name} یک صرافی نیست — پل انتقال ارز بین شبکه‌های L2 است و API کیف پول/موجودی ندارد؛ برای مدیریت دارایی یک صرافی دیگر اضافه کنید`
  );
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

const FOREIGN_FETCHERS: Partial<
  Record<ExchangeId, (w: ForeignWallet) => Promise<ForeignBalance[]>>
> = {
  mexc: fetchMexc,
  kucoin: fetchKucoin,
  bitget: fetchBitget,
  gateio: fetchGateio,
  htx: fetchHtx,
  huobi: fetchHtx, // Huobi = HTX (rebrand) — same platform/API
  toobit: fetchToobit,
  bingx: fetchBingx,
  bitmart: fetchBitmart,
  superex: fetchSuperex,
  coinex: fetchCoinex,
  phemex: fetchPhemex,
  lbank: fetchLbank,
  xt: fetchXt,
  bitunix: fetchBitunix,
  kcex: fetchKcex,
  iranicart: fetchIranicart,
};

export async function fetchForeignExchangeBalance(
  exchangeId: ExchangeId,
  wallet: ForeignWallet
): Promise<ForeignBalance[]> {
  if (exchangeId === 'orbiter') throw orbiterError(wallet.exchangeName);
  const fetcher = FOREIGN_FETCHERS[exchangeId];
  if (!fetcher) {
    throw new Error(
      `صرافی ${wallet.exchangeName} هنوز پشتیبانی نمی‌شود — به‌زودی اضافه می‌شود`
    );
  }
  if (!wallet.apiKey?.trim() || !wallet.apiSecret?.trim()) {
    throw new Error(
      `کلید API و Secret برای ${wallet.exchangeName} ثبت نشده — صرافی را حذف و دوباره با کلید معتبر اضافه کنید`
    );
  }
  let balances: ForeignBalance[];
  try {
    balances = await fetcher(wallet);
  } catch (e) {
    if (e instanceof Error) throw e;
    throw networkError(wallet.exchangeName, e);
  }
  await valueInUsd(balances);
  return balances;
}

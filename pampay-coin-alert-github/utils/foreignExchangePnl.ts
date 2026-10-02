/**
 * foreignExchangePnl.ts — v1.4.8 period PnL (30/90/180/360 days) for the
 * foreign exchanges whose APIs expose closed-position / income history.
 *
 *   • MEXC    — GET https://api.mexc.com/api/v1/private/position/list/history_positions
 *               (futures closed positions: `realised` = realized PnL,
 *               `holdFee` = funding fee)
 *               Auth: ApiKey / Request-Time / Signature headers where
 *               Signature = HMAC-SHA256(secret, apiKey + timestamp + sortedParams)
 *               — validated live (fake key → «API Key expired», i.e. the route
 *               and the signature scheme are accepted).
 *   • Bitget  — GET https://api.bitget.com/api/v2/mix/position/history-position
 *               (closed positions with pnl / fee / funding fee / open-close times)
 *               Auth: ACCESS-* headers (same scheme as the balance endpoint —
 *               validated live: fake key → 40037 «Apikey does not exist»).
 *
 * Returns null for any other exchange id — the wallet dispatcher then shows
 * the «این صرافی در API خود سود/زیان دوره‌ای ارائه نمی‌دهد» note as before.
 */

import CryptoJS from 'crypto-js';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PAGES = 10;

export interface ForeignPeriodPnl {
  realizedPnl: number;
  fundingFees: number;
  commissions: number;
  closedCount: number;
}

interface RawResp {
  ok: boolean;
  status: number;
  text: string;
}

async function rawFetch(url: string, init: RequestInit = {}): Promise<RawResp> {
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

function toNum(v: unknown): number {
  const n = parseFloat(String(v ?? '0'));
  return Number.isFinite(n) ? n : 0;
}

/** Timestamp normalizer (s / ms / seconds-as-string → epoch ms). */
function toMs(v: unknown): number {
  const n = toNum(v);
  if (n <= 0) return 0;
  return n > 1e12 ? n : n > 1e9 ? n * 1000 : 0;
}

export interface ForeignPnlCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string;
}

// ---------------------------------------------------------------------------
// MEXC
// ---------------------------------------------------------------------------

async function mexcPeriodPnl(w: ForeignPnlCredentials, days: number): Promise<ForeignPeriodPnl | null> {
  const windowStart = Date.now() - days * 86_400_000;
  let realizedPnl = 0;
  let fundingFees = 0;
  let commissions = 0;
  let closedCount = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    // MEXC sign string: apiKey + timestamp + business params SORTED + '&' joined.
    const params: Record<string, string> = { page: String(page), pageSize: '50' };
    const qsSorted = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    const ts = Date.now();
    const signature = CryptoJS.HmacSHA256(
      `${w.apiKey}${ts}${qsSorted}`,
      w.apiSecret
    ).toString(CryptoJS.enc.Hex);

    const res = await rawFetch(
      `https://api.mexc.com/api/v1/private/position/list/history_positions?${qsSorted}`,
      {
        headers: {
          ApiKey: w.apiKey,
          'Request-Time': String(ts),
          Signature: signature,
          'Content-Type': 'application/json',
        },
      }
    );
    const body = parseJson(res.text);
    if (!body) throw new Error(`پاسخ نامعتبر از MEXC (HTTP ${res.status})`);

    // auth failures → precise Persian error
    const code = String(body.code ?? '');
    const message = String(body.message ?? body.msg ?? '');
    if (
      res.status === 401 ||
      code === '401' ||
      code === '402' ||
      /expired|invalid|not\s*exist/i.test(message)
    ) {
      throw new Error(
        `کلید API مکسی معتبر نیست یا دسترسی «View Order Details» ندارد (${message || code}) — در MEXC → API Management کلید را با مجوز خواندن بسازید`
      );
    }
    if (body.success === false && code !== '0' && code !== '200') {
      throw new Error(`خطای MEXC در دریافت سود/زیان (کد ${code}): ${message}`);
    }

    // Response: { success, code, data: { totalPageNum, resultList: [...] } }
    const data = body.data as Record<string, unknown> | undefined;
    const rows = Array.isArray(data?.resultList)
      ? (data?.resultList as Array<Record<string, unknown>>)
      : Array.isArray(body.resultList)
        ? (body.resultList as Array<Record<string, unknown>>)
        : [];
    if (rows.length === 0) break;

    for (const r of rows) {
      const closeMs =
        toMs(r.closeDate) ?? toMs(r.createDate) ?? toMs(r.timestamp) ?? toMs(r.updateTime);
      if (closeMs > 0 && closeMs < windowStart) continue;
      realizedPnl += toNum(r.realised ?? r.realized ?? r.realisedPnl ?? r.pnl);
      fundingFees += toNum(r.holdFee ?? r.fundingFee ?? r.funding);
      commissions += toNum(r.closeTakerFee ?? r.fee ?? r.commission);
      closedCount++;
    }

    const totalPages = toNum(data?.totalPageNum) || 1;
    if (page >= totalPages) break;
  }

  return { realizedPnl, fundingFees, commissions, closedCount };
}

// ---------------------------------------------------------------------------
// Bitget
// ---------------------------------------------------------------------------

async function bitgetPeriodPnl(w: ForeignPnlCredentials, days: number): Promise<ForeignPeriodPnl | null> {
  const windowStart = Date.now() - days * 86_400_000;
  let realizedPnl = 0;
  let fundingFees = 0;
  let commissions = 0;
  let closedCount = 0;

  for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
    const path = '/api/v2/mix/position/history-position';
    const qs = `productType=USDT-FUTURES&pageSize=50&pageNo=${pageNo}`;
    const ts = Date.now().toString();
    const signature = CryptoJS.enc.Base64.stringify(
      CryptoJS.HmacSHA256(`${ts}GET${path}?${qs}`, w.apiSecret)
    );
    const res = await rawFetch(`https://api.bitget.com${path}?${qs}`, {
      headers: {
        'ACCESS-KEY': w.apiKey,
        'ACCESS-SIGN': signature,
        'ACCESS-TIMESTAMP': ts,
        'ACCESS-PASSPHRASE': w.passphrase ?? '',
        'Content-Type': 'application/json',
        locale: 'en-US',
      },
    });
    const body = parseJson(res.text);
    if (!body) throw new Error(`پاسخ نامعتبر از Bitget (HTTP ${res.status})`);

    const code = String(body.code ?? '');
    if (code === '40037' || code === '40036' || res.status === 401) {
      throw new Error(
        `کلید Bitget معتبر نیست (${String(body.msg ?? '')}) — کلید/Secret/Passphrase را چک کنید`
      );
    }
    if (code !== '00000') {
      throw new Error(`خطای Bitget در دریافت سود/زیان (کد ${code}): ${String(body.msg ?? '')}`);
    }

    const data = body.data as Record<string, unknown> | undefined;
    const rows = Array.isArray(data?.entrustedList)
      ? (data?.entrustedList as Array<Record<string, unknown>>)
      : Array.isArray(data?.list)
        ? (data?.list as Array<Record<string, unknown>>)
        : [];
    if (rows.length === 0) break;

    for (const r of rows) {
      const closeMs = toMs(r.closeTime ?? r.cTime ?? r.uTime);
      if (closeMs > 0 && closeMs < windowStart) continue;
      realizedPnl += toNum(r.pnl ?? r.profit ?? r.realisedPnl);
      fundingFees += toNum(r.fundingFee ?? r.fundingFees);
      commissions += toNum(r.fee ?? r.fees ?? r.tradeFee);
      closedCount++;
    }

    // Pagination: stop when fewer than pageSize rows came back.
    if (rows.length < 50) break;
  }

  return { realizedPnl, fundingFees, commissions, closedCount };
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Period PnL for the supported foreign exchanges. Returns null when this
 * exchange has no period-PnL API (the caller shows its own note then).
 * Network/auth problems THROW precise Persian errors.
 */
export async function fetchForeignPeriodPnl(
  exchangeId: string,
  w: ForeignPnlCredentials,
  days: number
): Promise<ForeignPeriodPnl | null> {
  switch (exchangeId) {
    case 'mexc':
      return mexcPeriodPnl(w, days);
    case 'bitget':
      return bitgetPeriodPnl(w, days);
    default:
      return null;
  }
}

/**
 * vpnGuard.ts — detects whether the phone's traffic currently exits from an
 * Iranian IP (VPN off) so the app can warn the user BEFORE their exchange
 * credentials/API keys touch blocked endpoints.
 *
 * Why it matters: Binance/Bybit/OKX/BitPerp (and Google's FCM servers) block
 * or geo-fence Iranian IPs. Connecting with the VPN off can trigger the
 * exchange's risk engine (451/418 responses, temporary API bans or — worst
 * case — account flags). One cheap country lookup up front prevents that.
 *
 * Detection = ask a tiny public geo-IP service where our request came from.
 * All endpoints are HTTPS, free, no API key, and reachable from Iran without
 * a VPN (they only ANSWER the question — they don't need to be unblocked).
 *
 * Result is cached for 2 minutes; every check has a 5s timeout and we try
 * the next provider on failure. 'unknown' never blocks anything — the banner
 * is only shown on a POSITIVE Iran match.
 */

export type VpnStatus = 'vpn' | 'iran' | 'unknown';

interface GeoProvider {
  name: string;
  url: string;
  /** Extract the 2-letter country code; return null when the answer is unusable. */
  extract: (data: unknown) => string | null;
}

const PROVIDERS: GeoProvider[] = [
  {
    name: 'country.is',
    url: 'https://api.country.is/',
    extract: (d) => (typeof (d as { country?: unknown })?.country === 'string' ? (d as { country: string }).country : null),
  },
  {
    name: 'ipwho.is',
    url: 'https://ipwho.is/',
    extract: (d) => {
      const rec = d as { success?: boolean; country_code?: unknown };
      return rec?.success && typeof rec.country_code === 'string' ? rec.country_code : null;
    },
  },
  {
    name: 'ipapi.co',
    url: 'https://ipapi.co/json/',
    extract: (d) => (typeof (d as { country_code?: unknown })?.country_code === 'string' ? (d as { country_code: string }).country_code : null),
  },
];

let cache: { at: number; status: VpnStatus } | null = null;
const CACHE_MS = 2 * 60_000;

/** In-flight promise so parallel components share one check. */
let inflight: Promise<VpnStatus> | null = null;

async function fetchWithTimeout(url: string, ms: number): Promise<unknown | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function checkOnce(): Promise<VpnStatus> {
  for (const p of PROVIDERS) {
    const data = await fetchWithTimeout(p.url, 5_000);
    const country = data ? p.extract(data) : null;
    if (country) {
      return country.toUpperCase() === 'IR' ? 'iran' : 'vpn';
    }
  }
  return 'unknown';
}

/**
 * Current exit-IP status. 'iran' → the user's traffic is NOT going through a
 * VPN right now. 'vpn' → exit country is something else. 'unknown' → all
 * providers failed (rare) — treat as no-warning.
 */
export async function checkVpnStatus(force = false): Promise<VpnStatus> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) {
    return cache.status;
  }
  if (inflight) return inflight;
  inflight = checkOnce()
    .then((status) => {
      cache = { at: Date.now(), status };
      return status;
    })
    .catch(() => 'unknown' as const)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * The exchanges whose APIs are unreachable (or actively risky) from an
 * Iranian IP — used to decide whether the warning is relevant.
 */
const FOREIGN_EXCHANGE_IDS = new Set([
  'binance',
  'bybit',
  'okx',
  'kucoin',
  'toobit',
  'bingx',
  'mexc',
  'bitunix',
  'bitget',
  'gateio',
  'htx',
  'coinex',
  'xt',
  'lbank',
  'phemex',
  'superex',
  'bitmart',
  'kcex',
  'orbiter',
  'huobi',
  'bitperp',
]);

export function isForeignExchange(exchangeId: string): boolean {
  return FOREIGN_EXCHANGE_IDS.has(exchangeId);
}

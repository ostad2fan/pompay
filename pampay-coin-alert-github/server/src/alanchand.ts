// server/src/alanchand.ts — USDT/Toman price from the Alan.Chand JSON API
// (https://api.alanchand.com), authenticated with the project's API token.
// Ported 1:1 from the Cloudflare Worker version; env is read from process.env.
// The token is read from env; both NOBITEX key values and a dedicated
// ALANCHAND_API_TOKEN are tried as Bearer tokens.

const ALANCHAND_API_URL = "https://api.alanchand.com?type=currency&symbols=usd";

export interface TomanResult {
  usdtToToman: number;
  lastUpdated: number;
  source: string;
  detail?: string;
}

/**
 * Extracts the USD price (Rial or Toman) from an Alan.Chand API response.
 * The exact response shape isn't publicly documented, so we search for
 * well-known price fields first and fall back to a bounded recursive scan.
 */
function extractAlanchandPrice(data: unknown): number | null {
  const pickPrice = (obj: Record<string, unknown>): number | null => {
    for (const key of ["sell_price", "sellPrice", "price", "sell"]) {
      const v = obj[key];
      if (typeof v === "number" && v > 0) return v;
      if (typeof v === "string") {
        const n = parseFloat(v.replace(/[^\d.]/g, ""));
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
    return null;
  };
  const findObj = (node: unknown, depth = 0): Record<string, unknown> | null => {
    if (depth > 5 || node === null || typeof node !== "object") return null;
    const obj = node as Record<string, unknown>;
    if (pickPrice(obj) !== null) return obj;
    for (const v of Object.values(obj)) {
      const found = findObj(v, depth + 1);
      if (found) return found;
    }
    return null;
  };
  const obj = findObj(data);
  const raw = obj ? pickPrice(obj) : null;
  if (!raw) return null;
  // Prices are usually in Rial (e.g. 2040500) — convert to Toman; values that
  // already look like Toman pass through unchanged.
  if (raw > 1_000_000 && raw < 5_000_000) return raw / 10;
  if (raw > 100_000 && raw < 500_000) return raw;
  return null;
}

let cache: { at: number; data: TomanResult } | null = null;

export async function getAlanchandUsdtToman(): Promise<TomanResult> {
  if (cache && Date.now() - cache.at < 60_000) return cache.data;

  const keys = [
    process.env.ALANCHAND_API_TOKEN,
    process.env.NOBITEX_API_PUBLIC_KEY,
    process.env.NOBITEX_API_PRIVATE_KEY,
  ].filter((k): k is string => typeof k === "string" && k.length > 0);
  if (keys.length === 0) {
    return { usdtToToman: 0, lastUpdated: Date.now(), source: "unavailable", detail: "keys-missing" };
  }

  let detail = "";
  for (const key of keys) {
    try {
      const res = await fetch(ALANCHAND_API_URL, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      });
      detail = `http ${res.status}`;
      if (res.ok) {
        const data: unknown = await res.json();
        const price = extractAlanchandPrice(data);
        if (price) {
          const result: TomanResult = {
            usdtToToman: price,
            lastUpdated: Date.now(),
            source: "Alan.Chand API",
          };
          cache = { at: Date.now(), data: result };
          return result;
        }
        detail += " unexpected-shape";
      }
    } catch (e) {
      detail = `fetch: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return { usdtToToman: 0, lastUpdated: Date.now(), source: "unavailable", detail };
}

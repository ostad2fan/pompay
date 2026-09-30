// server/src/nobitex.ts — USDT/Toman price from Nobitex.
// Authenticated with the Nobitex API Key (Ed25519 signature) when
// NOBITEX_API_PUBLIC_KEY / NOBITEX_API_PRIVATE_KEY env vars are set, with a
// graceful fallback to the public market stats endpoint.
// Ported 1:1 from the Cloudflare Worker version (WebCrypto is global in Node 20+).

const NOBITEX_STATS_URL = "https://api.nobitex.ir/market/stats";
const STATS_PATH = "/market/stats";
const STATS_BODY = JSON.stringify({ srcCurrency: "usdt", dstCurrency: "rls" });

export interface TomanResult {
  usdtToToman: number;
  lastUpdated: number;
  source: string;
  detail?: string;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i + 2), 16);
  }
  return out;
}

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function base64UrlEncode(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64URL[b0 >> 2];
    out += B64URL[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 === undefined) break;
    out += B64URL[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 === undefined) break;
    out += B64URL[b2 & 63];
  }
  return out;
}

/** Signs `payload` with the Ed25519 seed (Nobitex private key, 64 hex chars). */
async function signPayload(payload: string, seedHex: string): Promise<string> {
  // Ed25519 private keys import into WebCrypto as PKCS#8 DER:
  // a fixed 16-byte prefix + the 32-byte seed.
  const pkcs8 = hexToBytes("302e020100300506032b657004220420" + seedHex);
  const key = await crypto.subtle.importKey("pkcs8", pkcs8 as unknown as BufferSource, { name: "Ed25519" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(payload) as unknown as BufferSource);
  return base64UrlEncode(new Uint8Array(sig));
}

let cache: { at: number; data: TomanResult } | null = null;

let lastDebug = "";

export async function getNobitexUsdtToman(): Promise<TomanResult> {
  if (cache && Date.now() - cache.at < 30_000) return cache.data;

  const publicKey = process.env.NOBITEX_API_PUBLIC_KEY ?? "";
  const privateKey = process.env.NOBITEX_API_PRIVATE_KEY ?? "";
  const timestamp = Math.floor(Date.now() / 1000);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "TraderBot/TradeMaster-1.0.0",
  };
  if (publicKey && privateKey) {
    try {
      headers["Nobitex-Key"] = publicKey;
      headers["Nobitex-Signature"] = await signPayload(
        `${timestamp}POST${STATS_PATH}${STATS_BODY}`,
        privateKey
      );
      headers["Nobitex-Timestamp"] = String(timestamp);
    } catch (e) {
      lastDebug = `sign: ${e instanceof Error ? e.message : String(e)}`;
      console.log("[Nobitex] signing failed, using public request:", e);
    }
  } else {
    lastDebug = "keys-missing";
  }

  try {
    const res = await fetch(NOBITEX_STATS_URL, { method: "POST", headers, body: STATS_BODY });
    lastDebug = `http ${res.status}`;
    if (res.ok) {
      const text = await res.text();
      const data = JSON.parse(text) as {
        stats?: Record<string, { latest?: string; lastTradePrice?: string }>;
      };
      const stats = data.stats?.["usdt-rls"];
      const raw = stats?.latest ?? stats?.lastTradePrice;
      const price = raw ? parseFloat(raw) / 10 : 0; // Rial -> Toman
      if (price > 10000 && price < 500000) {
        const result: TomanResult = { usdtToToman: price, lastUpdated: Date.now(), source: "Nobitex" };
        cache = { at: Date.now(), data: result };
        return result;
      }
      lastDebug += ` body:${text.slice(0, 200)}`;
    }
  } catch (e) {
    lastDebug += ` fetch: ${e instanceof Error ? e.message : String(e)}`;
    console.log("[Nobitex] stats request failed:", e);
  }
  return { usdtToToman: 0, lastUpdated: Date.now(), source: "unavailable", detail: lastDebug };
}

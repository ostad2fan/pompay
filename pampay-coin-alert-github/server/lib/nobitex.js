"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// functions/nobitex.ts
var nobitex_exports = {};
__export(nobitex_exports, {
  getNobitexUsdtToman: () => getNobitexUsdtToman
});
module.exports = __toCommonJS(nobitex_exports);
var NOBITEX_STATS_URL = "https://api.nobitex.ir/market/stats";
var STATS_PATH = "/market/stats";
var STATS_BODY = JSON.stringify({ srcCurrency: "usdt", dstCurrency: "rls" });
function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
var B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function base64UrlEncode(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64URL[b0 >> 2];
    out += B64URL[(b0 & 3) << 4 | (b1 ?? 0) >> 4];
    if (b1 === void 0) break;
    out += B64URL[(b1 & 15) << 2 | (b2 ?? 0) >> 6];
    if (b2 === void 0) break;
    out += B64URL[b2 & 63];
  }
  return out;
}
async function signPayload(payload, seedHex) {
  const pkcs8 = hexToBytes("302e020100300506032b657004220420" + seedHex);
  const key = await crypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
  const sig = await crypto.subtle.sign({ name: "Ed25519" }, key, new TextEncoder().encode(payload));
  return base64UrlEncode(new Uint8Array(sig));
}
var cache = null;
var lastDebug = "";
async function getNobitexUsdtToman(env) {
  if (cache && Date.now() - cache.at < 3e4) return cache.data;
  const publicKey = env.NOBITEX_API_PUBLIC_KEY ?? "";
  const privateKey = env.NOBITEX_API_PRIVATE_KEY ?? "";
  const timestamp = Math.floor(Date.now() / 1e3);
  const headers = {
    "Content-Type": "application/json",
    "User-Agent": "TraderBot/TradeMaster-1.0.0"
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
      const data = JSON.parse(text);
      const stats = data.stats?.["usdt-rls"];
      const raw = stats?.latest ?? stats?.lastTradePrice;
      const price = raw ? parseFloat(raw) / 10 : 0;
      if (price > 1e4 && price < 5e5) {
        const result = { usdtToToman: price, lastUpdated: Date.now(), source: "Nobitex" };
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getNobitexUsdtToman
});

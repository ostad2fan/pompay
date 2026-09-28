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

// functions/alanchand.ts
var alanchand_exports = {};
__export(alanchand_exports, {
  getAlanchandUsdtToman: () => getAlanchandUsdtToman
});
module.exports = __toCommonJS(alanchand_exports);
var ALANCHAND_API_URL = "https://api.alanchand.com?type=currency&symbols=usd";
function extractAlanchandPrice(data) {
  const pickPrice = (obj2) => {
    for (const key of ["sell_price", "sellPrice", "price", "sell"]) {
      const v = obj2[key];
      if (typeof v === "number" && v > 0) return v;
      if (typeof v === "string") {
        const n = parseFloat(v.replace(/[^\d.]/g, ""));
        if (Number.isFinite(n) && n > 0) return n;
      }
    }
    return null;
  };
  const findObj = (node, depth = 0) => {
    if (depth > 5 || node === null || typeof node !== "object") return null;
    const obj2 = node;
    if (pickPrice(obj2) !== null) return obj2;
    for (const v of Object.values(obj2)) {
      const found = findObj(v, depth + 1);
      if (found) return found;
    }
    return null;
  };
  const obj = findObj(data);
  const raw = obj ? pickPrice(obj) : null;
  if (!raw) return null;
  if (raw > 1e6 && raw < 5e6) return raw / 10;
  if (raw > 1e5 && raw < 5e5) return raw;
  return null;
}
var cache = null;
async function getAlanchandUsdtToman(env) {
  if (cache && Date.now() - cache.at < 6e4) return cache.data;
  const keys = [env.NOBITEX_API_PUBLIC_KEY, env.NOBITEX_API_PRIVATE_KEY].filter(
    (k) => typeof k === "string" && k.length > 0
  );
  if (keys.length === 0) {
    return { usdtToToman: 0, lastUpdated: Date.now(), source: "unavailable", detail: "keys-missing" };
  }
  let detail = "";
  for (const key of keys) {
    try {
      const res = await fetch(ALANCHAND_API_URL, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }
      });
      detail = `http ${res.status}`;
      if (res.ok) {
        const data = await res.json();
        const price = extractAlanchandPrice(data);
        if (price) {
          const result = {
            usdtToToman: price,
            lastUpdated: Date.now(),
            source: "Alan.Chand API"
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  getAlanchandUsdtToman
});

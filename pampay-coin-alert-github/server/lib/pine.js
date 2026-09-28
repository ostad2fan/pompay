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

// functions/pine.ts
var pine_exports = {};
__export(pine_exports, {
  evaluatePineSubset: () => evaluatePineSubset
});
module.exports = __toCommonJS(pine_exports);
function tokenize(expr) {
  const tokens = [];
  let i = 0;
  const isIdentStart = (c) => /[A-Za-z_]/.test(c);
  const isIdent = (c) => /[A-Za-z0-9_.]/.test(c);
  while (i < expr.length) {
    const c = expr[i];
    if (c === " " || c === "	") {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || c === "." && /[0-9]/.test(expr[i + 1] ?? "")) {
      let j = i;
      while (j < expr.length && /[0-9_.]/.test(expr[j])) j++;
      tokens.push({ type: "num", value: expr.slice(i, j) });
      i = j;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i;
      while (j < expr.length && isIdent(expr[j])) j++;
      tokens.push({ type: "ident", value: expr.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      let j = i + 1;
      while (j < expr.length && expr[j] !== quote) j++;
      tokens.push({ type: "ident", value: "" });
      i = j + 1;
      continue;
    }
    const two = expr.slice(i, i + 2);
    if ([">=", "<=", "==", "!="].includes(two)) {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    if ("+-*/%<>(),?:=[]".includes(c)) {
      tokens.push({ type: "op", value: c });
      i++;
      continue;
    }
    i++;
  }
  return tokens;
}
var Parser = class {
  constructor(tokens, vars) {
    this.tokens = tokens;
    this.vars = vars;
  }
  tokens;
  vars;
  pos = 0;
  parse() {
    try {
      const node = this.parseTernary();
      if (this.pos !== this.tokens.length) return null;
      return node;
    } catch {
      return null;
    }
  }
  peek() {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null;
  }
  consume() {
    if (this.pos >= this.tokens.length) throw new Error("unexpected end");
    return this.tokens[this.pos++];
  }
  expectOp(op) {
    const t = this.consume();
    if (!(t.type === "op" && t.value === op)) throw new Error(`expected ${op}`);
  }
  matchOp(...ops) {
    const t = this.peek();
    if (t && t.type === "op" && ops.includes(t.value)) {
      this.pos++;
      return true;
    }
    return false;
  }
  parseTernary() {
    const cond = this.parseOr();
    if (this.matchOp("?")) {
      const thenN = this.parseTernary();
      this.expectOp(":");
      const elseN = this.parseTernary();
      return (i) => cond(i) > 0 ? thenN(i) : elseN(i);
    }
    return cond;
  }
  parseOr() {
    let left = this.parseAnd();
    while (this.matchOpIdent("or")) {
      const right = this.parseAnd();
      const l = left;
      left = (i) => l(i) > 0 || right(i) > 0 ? 1 : 0;
    }
    return left;
  }
  parseAnd() {
    let left = this.parseNot();
    while (this.matchOpIdent("and")) {
      const right = this.parseNot();
      const l = left;
      left = (i) => l(i) > 0 && right(i) > 0 ? 1 : 0;
    }
    return left;
  }
  matchOpIdent(word) {
    const t = this.peek();
    if (t && t.type === "ident" && t.value === word) {
      this.pos++;
      return true;
    }
    return false;
  }
  parseNot() {
    if (this.matchOpIdent("not")) {
      const inner = this.parseNot();
      return (i) => inner(i) > 0 ? 0 : 1;
    }
    return this.parseComparison();
  }
  parseComparison() {
    let left = this.parseAdditive();
    const t = this.peek();
    if (t && t.type === "op" && [">", "<", ">=", "<=", "==", "!="].includes(t.value)) {
      this.consume();
      const op = t.value;
      const right = this.parseAdditive();
      left = (i) => cmp(op, left(i), right(i));
    }
    return left;
  }
  parseAdditive() {
    let left = this.parseMultiplicative();
    while (true) {
      const t = this.peek();
      if (t && t.type === "op" && (t.value === "+" || t.value === "-")) {
        this.consume();
        const op = t.value;
        const l = left;
        const right = this.parseMultiplicative();
        left = op === "+" ? (i) => l(i) + right(i) : (i) => l(i) - right(i);
      } else break;
    }
    return left;
  }
  parseMultiplicative() {
    let left = this.parseUnary();
    while (true) {
      const t = this.peek();
      if (t && t.type === "op" && ["*", "/", "%"].includes(t.value)) {
        this.consume();
        const op = t.value;
        const l = left;
        const right = this.parseUnary();
        left = op === "*" ? (i) => l(i) * right(i) : op === "/" ? (i) => right(i) === 0 ? NaN : l(i) / right(i) : (i) => right(i) === 0 ? NaN : l(i) % right(i);
      } else break;
    }
    return left;
  }
  parseUnary() {
    if (this.matchOp("-")) {
      const inner = this.parseUnary();
      return (i) => -inner(i);
    }
    return this.parsePostfix();
  }
  /** Handles history indexing close[2] and builtin/function calls. */
  parsePostfix() {
    let node = this.parsePrimary();
    while (this.matchOp("[")) {
      const idxTok = this.consume();
      this.expectOp("]");
      if (idxTok.type !== "num") throw new Error("history index must be a literal");
      const n = parseInt(idxTok.value, 10);
      const inner = node;
      node = (i) => inner(i - n);
    }
    return node;
  }
  parsePrimary() {
    const t = this.peek();
    if (!t) throw new Error("unexpected end");
    if (t.type === "num") {
      this.consume();
      const v = parseFloat(t.value);
      return () => v;
    }
    if (t.type === "ident") {
      this.consume();
      const name = t.value;
      if (name === "") return () => 0;
      if (name === "true") return () => 1;
      if (name === "false") return () => 0;
      if (name === "na") return () => NaN;
      const next = this.peek();
      if (next && next.type === "op" && next.value === "(") {
        this.consume();
        const args = [];
        if (!this.matchOp(")")) {
          args.push(this.parseCallArg());
          while (this.matchOp(",")) args.push(this.parseCallArg());
          this.expectOp(")");
        }
        return makeFunction(name, args, () => this.vars);
      }
      const cachedName = name;
      const fn = (i) => {
        const resolved = this.vars.get(cachedName);
        if (!resolved) return NaN;
        return resolved(i);
      };
      return fn;
    }
    if (t.type === "op" && t.value === "(") {
      this.consume();
      const inner = this.parseTernary();
      this.expectOp(")");
      return inner;
    }
    throw new Error(`unexpected token ${t.value}`);
  }
  /** Args may be named (length=14) — take the value expression only. */
  parseCallArg() {
    const save = this.pos;
    const t = this.peek();
    const after = this.tokens[this.pos + 1];
    if (t && t.type === "ident" && !t.value.includes(".") && after && after.type === "op" && after.value === "=" && !(this.tokens[this.pos + 2]?.value === "=")) {
      this.pos += 2;
    } else {
      this.pos = save;
    }
    return this.parseTernary();
  }
};
function cmp(op, a, b) {
  switch (op) {
    case ">":
      return a > b ? 1 : 0;
    case "<":
      return a < b ? 1 : 0;
    case ">=":
      return a >= b ? 1 : 0;
    case "<=":
      return a <= b ? 1 : 0;
    case "==":
      return a === b ? 1 : 0;
    case "!=":
      return a !== b ? 1 : 0;
    default:
      return 0;
  }
}
function sma(src, len) {
  return (i) => {
    if (i - len + 1 < 0) return NaN;
    let s = 0;
    for (let k = i - len + 1; k <= i; k++) s += src(k);
    return s / len;
  };
}
function ema(src, len) {
  return (i) => {
    if (i === 0) return src(0);
    const alpha = 2 / (len + 1);
    let prev = ema(src, len)(i - 1);
    if (Number.isNaN(prev)) prev = src(i - 1);
    return src(i) * alpha + prev * (1 - alpha);
  };
}
function rma(src, len) {
  const cache = /* @__PURE__ */ new Map();
  const helper = (i) => {
    if (cache.has(i)) return cache.get(i);
    let val;
    if (i - len + 1 < 0) {
      val = i === 0 ? src(0) : helper(i - 1);
    } else if (i - len + 1 === 0) {
      let s = 0;
      for (let k = 0; k <= i; k++) s += src(k);
      val = s / len;
    } else {
      val = (helper(i - 1) * (len - 1) + src(i)) / len;
    }
    cache.set(i, val);
    return val;
  };
  return helper;
}
function rsi(src, len) {
  const up = (i) => Math.max(src(i) - src(i - 1), 0);
  const down = (i) => Math.max(src(i - 1) - src(i), 0);
  const avgUp = rma(up, len);
  const avgDown = rma(down, len);
  return (i) => {
    if (i < len + 1) return NaN;
    const du = avgDown(i);
    if (du === 0) return 100;
    return 100 - 100 / (1 + avgUp(i) / du);
  };
}
function highest(src, len) {
  return (i) => {
    if (i - len + 1 < 0) return NaN;
    let h = -Infinity;
    for (let k = i - len + 1; k <= i; k++) h = Math.max(h, src(k));
    return h;
  };
}
function lowest(src, len) {
  return (i) => {
    if (i - len + 1 < 0) return NaN;
    let l = Infinity;
    for (let k = i - len + 1; k <= i; k++) l = Math.min(l, src(k));
    return l;
  };
}
function change(src) {
  return (i) => i === 0 ? NaN : src(i) - src(i - 1);
}
function crossover(a, b) {
  return (i) => i === 0 ? 0 : a(i) > b(i) && a(i - 1) <= b(i - 1) ? 1 : 0;
}
function crossunder(a, b) {
  return (i) => i === 0 ? 0 : a(i) < b(i) && a(i - 1) >= b(i - 1) ? 1 : 0;
}
function crossAny(a, b) {
  const up = crossover(a, b);
  const down = crossunder(a, b);
  return (i) => up(i) || down(i) ? 1 : 0;
}
function makeFunction(fullName, args, getVars) {
  const argFn = (n) => args[n] ?? (() => NaN);
  const numArg = (n) => {
    const v = argFn(n)(100);
    return Number.isNaN(v) ? NaN : v;
  };
  switch (fullName) {
    case "ta.tr": {
      const candles = getCandles(getVars);
      return (i) => {
        if (i <= 0) return candles[i].high - candles[i].low;
        const prevClose = candles[i - 1].close;
        return Math.max(candles[i].high, prevClose) - Math.min(candles[i].low, prevClose);
      };
    }
    case "ta.rsi":
      return rsi(argFn(0), Math.round(numArg(1)));
    case "ta.sma":
      return sma(argFn(0), Math.round(numArg(1)));
    case "ta.wma":
      return sma(argFn(0), Math.round(numArg(1)));
    // approximated by SMA
    case "ta.hma":
      return sma(argFn(0), Math.round(numArg(1)));
    // approximated by SMA
    case "ta.ema":
      return ema(argFn(0), Math.round(numArg(1)));
    case "ta.rma":
      return rma(argFn(0), Math.round(numArg(1)));
    case "ta.atr": {
      const tr = makeFunction("ta.tr", [], getVars);
      return rma(tr, Math.round(numArg(0)));
    }
    case "ta.highest":
      return highest(argFn(0), Math.round(numArg(1)));
    case "ta.lowest":
      return lowest(argFn(0), Math.round(numArg(1)));
    case "ta.crossover":
      return crossover(argFn(0), argFn(1));
    case "ta.crossunder":
      return crossunder(argFn(0), argFn(1));
    case "ta.cross":
      return crossAny(argFn(0), argFn(1));
    case "ta.change":
      return change(argFn(0));
    case "math.abs":
      return (i) => Math.abs(argFn(0)(i));
    case "math.sqrt":
      return (i) => Math.sqrt(Math.abs(argFn(0)(i)));
    case "math.pow":
      return (i) => Math.pow(Math.abs(argFn(0)(i)), Math.abs(numArg(1)));
    case "math.round":
      return (i) => Math.round(argFn(0)(i));
    case "math.min":
      return (i) => Math.min(...args.map((a) => a(i)).filter((v) => !Number.isNaN(v)));
    case "math.max":
      return (i) => Math.max(...args.map((a) => a(i)).filter((v) => !Number.isNaN(v)));
    default:
      return () => NaN;
  }
}
var CANDLE_CONTEXTS = /* @__PURE__ */ new WeakMap();
var activeCandlesContext = null;
function getCandles(getVars) {
  if (activeCandlesContext) return activeCandlesContext;
  const fromVars = CANDLE_CONTEXTS.get(getVars);
  return fromVars ?? [];
}
function preprocessInputs(code) {
  return code.replace(/input\.(?:int|float|bool)\(([^()]*)\)/g, (_m, body) => {
    const def = body.split(",")[0].trim() || "0";
    return def;
  });
}
function extractStatements(code) {
  const rawLines = code.split("\n");
  const cleaned = [];
  let blockIndent = null;
  for (const line of rawLines) {
    let text = line.replace(/\/\/.*$/, "").replace(/\r$/, "");
    if (!text.trim()) {
      blockIndent = null;
      continue;
    }
    const indent = text.search(/\S/);
    if (blockIndent !== null) {
      if (indent > blockIndent) continue;
      blockIndent = null;
    }
    const trimmed = text.trim();
    if (/^(if|for|while|else)\b/.test(trimmed)) {
      blockIndent = indent;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_.]*\(.*\)\s*$/.test(trimmed)) continue;
    text = preprocessInputs(text);
    cleaned.push(text);
  }
  return cleaned;
}
function evaluatePineSubset(code, candles) {
  if (candles.length < 20) return null;
  const statements = extractStatements(code);
  const vars = /* @__PURE__ */ new Map();
  const length = candles.length;
  const baseSeries = {
    open: (i) => candles[Math.min(i, length - 1)]?.open ?? NaN,
    high: (i) => candles[Math.min(i, length - 1)]?.high ?? NaN,
    low: (i) => candles[Math.min(i, length - 1)]?.low ?? NaN,
    close: (i) => candles[Math.min(i, length - 1)]?.close ?? NaN,
    volume: (i) => candles[Math.min(i, length - 1)]?.volume ?? NaN,
    hl2: (i) => (candles[Math.min(i, length - 1)].high + candles[Math.min(i, length - 1)].low) / 2,
    hlc3: (i) => {
      const c = candles[Math.min(i, length - 1)];
      return (c.high + c.low + c.close) / 3;
    },
    ohlc4: (i) => {
      const c = candles[Math.min(i, length - 1)];
      return (c.open + c.high + c.low + c.close) / 4;
    },
    tr: (i) => {
      if (i <= 0) return candles[0].high - candles[0].low;
      const pc = candles[i - 1].close;
      return Math.max(candles[i].high, pc) - Math.min(candles[i].low, pc);
    },
    "barstate.isconfirmed": () => 1,
    "time": (i) => candles[Math.min(i, length - 1)].openTime
  };
  const resolveBase = (name) => baseSeries[name];
  for (const stmt of statements) {
    const m = stmt.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(:?=)\s*(.+)$/);
    if (!m) continue;
    const [, target, assignOp, exprText] = m;
    const parser = new Parser(tokenize(exprText), vars);
    const evalNode = parser.parse();
    if (!evalNode) continue;
    if (assignOp === ":=") {
      if (vars.has(target)) {
        const prevVal = vars.get(target)(length - 1);
        vars.set(target, () => prevVal);
      }
      continue;
    }
    const wrapped = (i) => {
      const safeIdx = i < 0 ? 0 : i > length - 1 ? length - 1 : i;
      const base = resolveBase("__dummy__");
      void base;
      return Number.isFinite(safeIdx) ? evalNode(safeIdx) : NaN;
    };
    vars.set(target, wrapped);
    resolveBase.length;
  }
  for (const [key, fn] of Object.entries(baseSeries)) {
    if (!vars.has(key)) {
      vars.set(key, (i) => {
        const idx = i < 0 ? 0 : Math.min(i, length - 1);
        return fn(idx);
      });
    }
  }
  activeCandlesContext = candles;
  const varsGetter = () => vars;
  CANDLE_CONTEXTS.set(varsGetter, candles);
  const last = length - 1;
  let buySignal = false;
  let sellSignal = false;
  try {
    for (const [name] of vars) {
      if (/^(bull|buy|long)/i.test(name) || /_(bull|buy|long)$/i.test(name)) {
        if (vars.get(name)(last) > 0) buySignal = true;
      }
      if (/^(bear|sell|short)/i.test(name) || /_(bear|sell|short)$/i.test(name)) {
        if (vars.get(name)(last) > 0) sellSignal = true;
      }
    }
  } finally {
    activeCandlesContext = null;
  }
  return { buySignal, sellSignal };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  evaluatePineSubset
});

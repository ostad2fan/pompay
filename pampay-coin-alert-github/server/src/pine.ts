/**
 * Lightweight Pine Script v5 subset interpreter for user-defined indicators.
 *
 * Evaluates a script bar-by-bar over OHLCV series and reports whether a
 * buy/sell condition fired on the LAST confirmed bar.
 *
 * Supported:
 *  - statements: `name = expr` and `name := expr` (others like plot/label/alertcondition are ignored)
 *  - inputs: input.int/float/bool(DEFAULT, ...) replaced with DEFAULT
 *  - built-in series: open, high, low, close, volume, hl2, hlc3, ohlc4, ta.tr, barstate.isconfirmed
 *  - functions: ta.rsi/sma/ema/wma/rma/atr/highest/lowest/crossover/crossunder/cross/change,
 *               math.abs/min/max/pow/sqrt/round
 *  - operators: + - * / % comparisons and/or/not, parentheses, ternary (a ? b : c)
 *  - history indexing: close[1], myVar[5]
 *
 * Signal detection: any variable whose name matches bull/buy/long → BUY,
 * bear/sell/short → SELL. A signal fires when that variable is true on the
 * last confirmed bar of the scanned symbol/timeframe.
 */

export interface PineCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PineEvalResult {
  buySignal: boolean;
  sellSignal: boolean;
}

type Value = number[] | number;

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

type TokenType = 'num' | 'ident' | 'op';
interface Token {
  type: TokenType;
  value: string;
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const isIdentStart = (c: string) => /[A-Za-z_]/.test(c);
  const isIdent = (c: string) => /[A-Za-z0-9_.]/.test(c);

  while (i < expr.length) {
    const c = expr[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(expr[i + 1] ?? ''))) {
      let j = i;
      while (j < expr.length && /[0-9_.]/.test(expr[j])) j++;
      tokens.push({ type: 'num', value: expr.slice(i, j) });
      i = j;
      continue;
    }
    if (isIdentStart(c)) {
      let j = i;
      while (j < expr.length && isIdent(expr[j])) j++;
      tokens.push({ type: 'ident', value: expr.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "'" || c === '"') {
      // skip string literal (titles etc.)
      const quote = c;
      let j = i + 1;
      while (j < expr.length && expr[j] !== quote) j++;
      tokens.push({ type: 'ident', value: '' }); // empty placeholder for strings
      i = j + 1;
      continue;
    }
    // multi-char operators first
    const two = expr.slice(i, i + 2);
    if (['>=', '<=', '==', '!='].includes(two)) {
      tokens.push({ type: 'op', value: two });
      i += 2;
      continue;
    }
    if ('+-*/%<>(),?:=[]'.includes(c)) {
      tokens.push({ type: 'op', value: c });
      i++;
      continue;
    }
    // unknown char — skip defensively
    i++;
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// Parser -> evaluator closures (i: bar index) => number
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0;

  constructor(private tokens: Token[], private vars: Map<string, (i: number) => number>) {}

  parse(): ((i: number) => number) | null {
    try {
      const node = this.parseTernary();
      if (this.pos !== this.tokens.length) return null; // trailing garbage
      return node;
    } catch {
      return null;
    }
  }

  private peek(): Token | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null;
  }

  private consume(): Token {
    if (this.pos >= this.tokens.length) throw new Error('unexpected end');
    return this.tokens[this.pos++];
  }

  private expectOp(op: string): void {
    const t = this.consume();
    if (!(t.type === 'op' && t.value === op)) throw new Error(`expected ${op}`);
  }

  private matchOp(...ops: string[]): boolean {
    const t = this.peek();
    if (t && t.type === 'op' && ops.includes(t.value)) {
      this.pos++;
      return true;
    }
    return false;
  }

  private parseTernary(): (i: number) => number {
    const cond = this.parseOr();
    if (this.matchOp('?')) {
      const thenN = this.parseTernary();
      this.expectOp(':');
      const elseN = this.parseTernary();
      return (i) => (cond(i) > 0 ? thenN(i) : elseN(i));
    }
    return cond;
  }

  private parseOr(): (i: number) => number {
    let left = this.parseAnd();
    while (this.matchOpIdent('or')) {
      const right = this.parseAnd();
      const l = left;
      left = (i) => ((l(i) > 0 || right(i) > 0) ? 1 : 0);
    }
    return left;
  }

  private parseAnd(): (i: number) => number {
    let left = this.parseNot();
    while (this.matchOpIdent('and')) {
      const right = this.parseNot();
      const l = left;
      left = (i) => ((l(i) > 0 && right(i) > 0) ? 1 : 0);
    }
    return left;
  }

  private matchOpIdent(word: string): boolean {
    const t = this.peek();
    if (t && t.type === 'ident' && t.value === word) {
      this.pos++;
      return true;
    }
    return false;
  }

  private parseNot(): (i: number) => number {
    if (this.matchOpIdent('not')) {
      const inner = this.parseNot();
      return (i) => (inner(i) > 0 ? 0 : 1);
    }
    return this.parseComparison();
  }

  private parseComparison(): (i: number) => number {
    let left = this.parseAdditive();
    const t = this.peek();
    if (t && t.type === 'op' && ['>', '<', '>=', '<=', '==', '!='].includes(t.value)) {
      this.consume();
      const op = t.value;
      const right = this.parseAdditive();
      left = (i) => cmp(op, left(i), right(i));
    }
    return left;
  }

  private parseAdditive(): (i: number) => number {
    let left = this.parseMultiplicative();
    while (true) {
      const t = this.peek();
      if (t && t.type === 'op' && (t.value === '+' || t.value === '-')) {
        this.consume();
        const op = t.value;
        const l = left;
        const right = this.parseMultiplicative();
        left = op === '+' ? (i) => l(i) + right(i) : (i) => l(i) - right(i);
      } else break;
    }
    return left;
  }

  private parseMultiplicative(): (i: number) => number {
    let left = this.parseUnary();
    while (true) {
      const t = this.peek();
      if (t && t.type === 'op' && ['*', '/', '%'].includes(t.value)) {
        this.consume();
        const op = t.value;
        const l = left;
        const right = this.parseUnary();
        left =
          op === '*' ? (i) => l(i) * right(i)
          : op === '/' ? (i) => (right(i) === 0 ? NaN : l(i) / right(i))
          : (i) => (right(i) === 0 ? NaN : l(i) % right(i));
      } else break;
    }
    return left;
  }

  private parseUnary(): (i: number) => number {
    if (this.matchOp('-')) {
      const inner = this.parseUnary();
      return (i) => -inner(i);
    }
    return this.parsePostfix();
  }

  /** Handles history indexing close[2] and builtin/function calls. */
  private parsePostfix(): (i: number) => number {
    let node = this.parsePrimary();

    while (this.matchOp('[')) {
      const idxTok = this.consume();
      this.expectOp(']');
      if (idxTok.type !== 'num') throw new Error('history index must be a literal');
      const n = parseInt(idxTok.value, 10);
      const inner = node;
      node = (i) => inner(i - n);
    }

    return node;
  }

  private parsePrimary(): (i: number) => number {
    const t = this.peek();
    if (!t) throw new Error('unexpected end');

    if (t.type === 'num') {
      this.consume();
      const v = parseFloat(t.value);
      return () => v;
    }

    if (t.type === 'ident') {
      this.consume();
      const name = t.value;

      if (name === '') return () => 0; // string placeholder

      // true / false / na
      if (name === 'true') return () => 1;
      if (name === 'false') return () => 0;
      if (name === 'na') return () => NaN;

      // function call?
      const next = this.peek();
      if (next && next.type === 'op' && next.value === '(') {
        this.consume(); // (
        const args: ((i: number) => number)[] = [];
        if (!this.matchOp(')')) {
          args.push(this.parseCallArg());
          while (this.matchOp(',')) args.push(this.parseCallArg());
          this.expectOp(')');
        }
        return makeFunction(name, args, () => this.vars);
      }

      // variable reference
      const cachedName = name;
      const fn: (i: number) => number = (i) => {
        const resolved = this.vars.get(cachedName);
        if (!resolved) return NaN;
        return resolved(i);
      };
      return fn;
    }

    if (t.type === 'op' && t.value === '(') {
      this.consume();
      const inner = this.parseTernary();
      this.expectOp(')');
      return inner;
    }

    throw new Error(`unexpected token ${t.value}`);
  }

  /** Args may be named (length=14) — take the value expression only. */
  private parseCallArg(): (i: number) => number {
    const save = this.pos;
    const t = this.peek();
    const after = this.tokens[this.pos + 1];
    if (t && t.type === 'ident' && !t.value.includes('.') && after &&
        after.type === 'op' && after.value === '=' &&
        !(this.tokens[this.pos + 2]?.value === '=')) {
      this.pos += 2; // skip "name="
    } else {
      this.pos = save;
    }
    return this.parseTernary();
  }
}

function cmp(op: string, a: number, b: number): number {
  switch (op) {
    case '>': return a > b ? 1 : 0;
    case '<': return a < b ? 1 : 0;
    case '>=': return a >= b ? 1 : 0;
    case '<=': return a <= b ? 1 : 0;
    case '==': return a === b ? 1 : 0;
    case '!=': return a !== b ? 1 : 0;
    default: return 0;
  }
}

// ---------------------------------------------------------------------------
// Builtin series & functions factory
// ---------------------------------------------------------------------------

function sma(src: (i: number) => number, len: number): (i: number) => number {
  return (i) => {
    if (i - len + 1 < 0) return NaN;
    let s = 0;
    for (let k = i - len + 1; k <= i; k++) s += src(k);
    return s / len;
  };
}

function ema(src: (i: number) => number, len: number): (i: number) => number {
  return (i) => {
    if (i === 0) return src(0);
    const alpha = 2 / (len + 1);
    let prev = ema(src, len)(i - 1); // memoized below by caller cache
    if (Number.isNaN(prev)) prev = src(i - 1);
    return src(i) * alpha + prev * (1 - alpha);
  };
}

function rma(src: (i: number) => number, len: number): (i: number) => number {
  const cache = new Map<number, number>();
  const helper = (i: number): number => {
    if (cache.has(i)) return cache.get(i)!;
    let val: number;
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

function rsi(src: (i: number) => number, len: number): (i: number) => number {
  const up = (i: number) => Math.max(src(i) - src(i - 1), 0);
  const down = (i: number) => Math.max(src(i - 1) - src(i), 0);
  const avgUp = rma(up, len);
  const avgDown = rma(down, len);
  return (i) => {
    if (i < len + 1) return NaN;
    const du = avgDown(i);
    if (du === 0) return 100;
    return 100 - 100 / (1 + avgUp(i) / du);
  };
}

function highest(src: (i: number) => number, len: number): (i: number) => number {
  return (i) => {
    if (i - len + 1 < 0) return NaN;
    let h = -Infinity;
    for (let k = i - len + 1; k <= i; k++) h = Math.max(h, src(k));
    return h;
  };
}

function lowest(src: (i: number) => number, len: number): (i: number) => number {
  return (i) => {
    if (i - len + 1 < 0) return NaN;
    let l = Infinity;
    for (let k = i - len + 1; k <= i; k++) l = Math.min(l, src(k));
    return l;
  };
}

function change(src: (i: number) => number): (i: number) => number {
  return (i) => (i === 0 ? NaN : src(i) - src(i - 1));
}

function crossover(a: (i: number) => number, b: (i: number) => number): (i: number) => number {
  return (i) => (i === 0 ? 0 : a(i) > b(i) && a(i - 1) <= b(i - 1) ? 1 : 0);
}
function crossunder(a: (i: number) => number, b: (i: number) => number): (i: number) => number {
  return (i) => (i === 0 ? 0 : a(i) < b(i) && a(i - 1) >= b(i - 1) ? 1 : 0);
}
function crossAny(a: (i: number) => number, b: (i: number) => number): (i: number) => number {
  const up = crossover(a, b);
  const down = crossunder(a, b);
  return (i) => (up(i) || down(i) ? 1 : 0);
}

type VarsGetter = () => Map<string, (i: number) => number>;

function makeFunction(
  fullName: string,
  args: ((i: number) => number)[],
  getVars: VarsGetter
): (i: number) => number {
  const argFn = (n: number): ((i: number) => number) => args[n] ?? (() => NaN);
  const numArg = (n: number): number => {
    // Evaluate scalar at bar 100 as representative (literals only in practice)
    const v = argFn(n)(100);
    return Number.isNaN(v) ? NaN : v;
  };

  switch (fullName) {
    case 'ta.tr': {
      const candles = getCandles(getVars);
      return (i) => {
        if (i <= 0) return candles[i].high - candles[i].low;
        const prevClose = candles[i - 1].close;
        return Math.max(candles[i].high, prevClose) - Math.min(candles[i].low, prevClose);
      };
    }
    case 'ta.rsi': return rsi(argFn(0), Math.round(numArg(1)));
    case 'ta.sma': return sma(argFn(0), Math.round(numArg(1)));
    case 'ta.wma': return sma(argFn(0), Math.round(numArg(1))); // approximated by SMA
    case 'ta.hma': return sma(argFn(0), Math.round(numArg(1))); // approximated by SMA
    case 'ta.ema': return ema(argFn(0), Math.round(numArg(1)));
    case 'ta.rma': return rma(argFn(0), Math.round(numArg(1)));
    case 'ta.atr': {
      const tr = makeFunction('ta.tr', [], getVars);
      return rma(tr, Math.round(numArg(0)));
    }
    case 'ta.highest': return highest(argFn(0), Math.round(numArg(1)));
    case 'ta.lowest': return lowest(argFn(0), Math.round(numArg(1)));
    case 'ta.crossover': return crossover(argFn(0), argFn(1));
    case 'ta.crossunder': return crossunder(argFn(0), argFn(1));
    case 'ta.cross': return crossAny(argFn(0), argFn(1));
    case 'ta.change': return change(argFn(0));
    case 'math.abs': return (i) => Math.abs(argFn(0)(i));
    case 'math.sqrt': return (i) => Math.sqrt(Math.abs(argFn(0)(i)));
    case 'math.pow': return (i) => Math.pow(Math.abs(argFn(0)(i)), Math.abs(numArg(1)));
    case 'math.round': return (i) => Math.round(argFn(0)(i));
    case 'math.min': return (i) => Math.min(...args.map((a) => a(i)).filter((v) => !Number.isNaN(v)));
    case 'math.max': return (i) => Math.max(...args.map((a) => a(i)).filter((v) => !Number.isNaN(v)));
    default:
      return () => NaN;
  }
}

/** Context handle set per evaluation run so ta.tr can reach candles. */
const CANDLE_CONTEXTS = new WeakMap<VarsGetter, PineCandle[]>();
let activeCandlesContext: PineCandle[] | null = null;

function getCandles(getVars: VarsGetter): PineCandle[] {
  if (activeCandlesContext) return activeCandlesContext;
  const fromVars = CANDLE_CONTEXTS.get(getVars);
  return fromVars ?? [];
}

/**
 * Rewrites input.* calls to their default value literal.
 */
function preprocessInputs(code: string): string {
  return code.replace(/input\.(?:int|float|bool)\(([^()]*)\)/g, (_m, body: string) => {
    const def = body.split(',')[0].trim() || '0';
    return def;
  });
}

/**
 * Removes comments and skips control-flow blocks (`if` bodies contain label.*
 * calls which are out of scope).
 */
function extractStatements(code: string): string[] {
  const rawLines = code.split('\n');
  const cleaned: string[] = [];
  let blockIndent: number | null = null;

  for (const line of rawLines) {
    let text = line.replace(/\/\/.*$/, '').replace(/\r$/, '');
    if (!text.trim()) { blockIndent = null; continue; }

    const indent = text.search(/\S/);
    if (blockIndent !== null) {
      if (indent > blockIndent) continue; // inside skipped block
      blockIndent = null;
    }

    const trimmed = text.trim();

    // Control flow lines start a block we cannot interpret
    if (/^(if|for|while|else)\b/.test(trimmed)) {
      blockIndent = indent;
      continue;
    }

    // Ignore plot/hline/alertcondition/strategy/etc. bare-call statements
    if (/^[A-Za-z_][A-Za-z0-9_.]*\(.*\)\s*$/.test(trimmed)) continue;

    text = preprocessInputs(text);
    cleaned.push(text);
  }
  return cleaned;
}

/**
 * Evaluates the script on the given confirmed candles and returns whether
 * buy/sell conditions were true on the last bar.
 */
export function evaluatePineSubset(code: string, candles: PineCandle[]): PineEvalResult | null {
  if (candles.length < 20) return null;

  const statements = extractStatements(code);
  const vars = new Map<string, (i: number) => number>();
  const length = candles.length;

  // Base series closures over the candle arrays
  const baseSeries: Record<string, (i: number) => number> = {
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
    'barstate.isconfirmed': () => 1,
    'time': (i) => candles[Math.min(i, length - 1)].openTime,
  };

  // History-capped lookups: negative index (before first bar) reads index 0
  const resolveBase = (name: string): ((i: number) => number) | undefined => baseSeries[name];

  for (const stmt of statements) {
    const m = stmt.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(:?=)\s*(.+)$/);
    if (!m) continue;
    const [, target, assignOp, exprText] = m;

    const parser = new Parser(tokenize(exprText), vars);
    const evalNode = parser.parse();
    if (!evalNode) continue;

    if (assignOp === ':=') {
      if (vars.has(target)) {
        const prevVal = vars.get(target)!(length - 1);
        vars.set(target, () => prevVal); // last assignment wins (state machine style)
      }
      continue;
    }

    const wrapped: (i: number) => number = (i) => {
      const safeIdx = i < 0 ? 0 : i > length - 1 ? length - 1 : i;
      const base = resolveBase('__dummy__'); // keep lint quiet about unused pattern
      void base;
      return Number.isFinite(safeIdx) ? evalNode(safeIdx) : NaN;
    };

    // Variable lookups must see latest definitions: bind lazily via closure over map
    vars.set(target, wrapped);

    // If the expression references base series directly they're already resolvable
    // through vars map fallback inside Parser.parsePrimary.
    resolveBase.length; // no-op
  }

  // Provide base series through the same lazy mechanism used by vars
  for (const [key, fn] of Object.entries(baseSeries)) {
    if (!vars.has(key)) {
      vars.set(key, (i) => {
        const idx = i < 0 ? 0 : Math.min(i, length - 1);
        return fn(idx);
      });
    }
  }

  activeCandlesContext = candles;
  const varsGetter = (): Map<string, (i: number) => number> => vars;
  CANDLE_CONTEXTS.set(varsGetter, candles);

  const last = length - 1;
  let buySignal = false;
  let sellSignal = false;

  try {
    for (const [name] of vars) {
      if (/^(bull|buy|long)/i.test(name) || /_(bull|buy|long)$/i.test(name)) {
        if (vars.get(name)!(last) > 0) buySignal = true;
      }
      if (/^(bear|sell|short)/i.test(name) || /_(bear|sell|short)$/i.test(name)) {
        if (vars.get(name)!(last) > 0) sellSignal = true;
      }
    }
  } finally {
    activeCandlesContext = null;
  }

  return { buySignal, sellSignal };
}

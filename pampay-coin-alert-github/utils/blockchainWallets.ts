import AsyncStorage from '@react-native-async-storage/async-storage';
import CryptoJS from 'crypto-js';

/**
 * blockchainWallets.ts — v1.4.17
 *
 * Types + storage for the «کیف پول بلاکچین (فقط خواندنی)» 4th tab.
 *
 * v1.4.17 — MULTI-NETWORK WALLETS:
 *   A wallet is a PUBLIC address + a LIST of networks to read it on.
 *   One 0x address is valid on every EVM chain at once (Ethereum / BNB Chain /
 *   Polygon / Arbitrum / Base / Filecoin-FEVM), so the user can tick any
 *   combination — «این کیف پول، شبکه‌های اتریوم و بایننس و آربیتروم و فایل‌کوین
 *   را داشته باشد». Tron / Bitcoin / Solana / native-Filecoin addresses have
 *   their own format → single network per wallet.
 *
 * A blockchain wallet entry is NOTHING but a PUBLIC address — no private key,
 * no seed phrase, no credentials. Balances are read from public keyless
 * explorers/RPCs (blockchainWalletApi.ts).
 */

export type BlockchainNetwork =
  | 'ethereum'
  | 'bsc'
  | 'polygon'
  | 'arbitrum'
  | 'base'
  | 'filecoin'
  | 'tron'
  | 'bitcoin'
  | 'solana';

export interface BlockchainWallet {
  id: string;
  /** User-chosen display name, e.g. «تراست ولتم — کیف اصلی». */
  name: string;
  /** v1.4.17 — networks to READ this address on (one entry for EVM chains). */
  networks: BlockchainNetwork[];
  /** PUBLIC address only — safe to store, impossible to withdraw from. */
  address: string;
  addedAt: number;
}

/** One held asset of a blockchain wallet (native coin or token). */
export interface BlockchainTokenBalance {
  /** Display symbol: ETH, USDT, BNB, SOL, TRX … */
  symbol: string;
  /** Persian/English display name. */
  name: string;
  kind: 'native' | 'token';
  qty: number;
  /** Resolved USD price (0 = unknown). */
  priceUsd: number;
  /** 24h price change percent (null = unknown). */
  change24hPct: number | null;
  valueUsd: number;
  /** Binance pair for the price (ETHUSDT…) — used for PnL history. */
  binancePair?: string;
  /** CoinGecko id (fallback price/history source). */
  coingeckoId?: string;
  /** v1.4.17 — the network this row was read from (badge on the token row). */
  network?: BlockchainNetwork;
}

export interface BlockchainWalletData {
  walletId: string;
  tokens: BlockchainTokenBalance[];
  totalUsd: number;
  fetchedAt: number;
  /** Non-fatal fetch issue (partial data) — shown under the wallet card. */
  notice?: string;
}

// ---------------------------------------------------------------------------
// Network metadata
// ---------------------------------------------------------------------------

export interface NetworkMeta {
  id: BlockchainNetwork;
  /** Persian label used in chips / pickers. */
  label: string;
  /** Short label for tight chips. */
  short: string;
  /** Native coin symbol. */
  native: string;
  /** Circle-avatar color. */
  color: string;
  /** Public RPC endpoints (JSON-RPC, keyless) — fallback path for EVM. */
  rpcs: string[];
  /** Blockscout API v2 root (EVM only) — primary path. */
  blockscout?: string;
  /** Address hint shown in the picker. */
  addrHint: string;
}

export const NETWORKS: Record<BlockchainNetwork, NetworkMeta> = {
  ethereum: {
    id: 'ethereum',
    label: 'اتریوم',
    short: 'ETH',
    native: 'ETH',
    color: '#627EEA',
    // v1.4.17 — publicnode verified keyless from all networks; llamarpc/
    // cloudflare kept as extra fallbacks.
    rpcs: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.ai', 'https://cloudflare-eth.com'],
    blockscout: 'https://eth.blockscout.com',
    addrHint: 'ETH • 0x…',
  },
  bsc: {
    id: 'bsc',
    label: 'BNB چین',
    short: 'BNB',
    native: 'BNB',
    color: '#F0B90B',
    rpcs: ['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com', 'https://bsc-dataseed1.defibit.io'],
    addrHint: 'BSC • 0x…',
  },
  polygon: {
    id: 'polygon',
    label: 'پالیگان',
    short: 'POL',
    native: 'POL',
    color: '#8247E5',
    // v1.4.17 — polygon-rpc.com now requires an API key; publicnode verified.
    rpcs: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-battlenet-rpc.publicnode.com'],
    blockscout: 'https://polygon.blockscout.com',
    addrHint: 'POL • 0x…',
  },
  arbitrum: {
    id: 'arbitrum',
    label: 'آربیتروم',
    short: 'ARB',
    native: 'ETH',
    color: '#28A0F0',
    rpcs: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
    blockscout: 'https://arbitrum.blockscout.com',
    addrHint: 'ARB • 0x…',
  },
  base: {
    id: 'base',
    label: 'بیس',
    short: 'BASE',
    native: 'ETH',
    color: '#0052FF',
    rpcs: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
    blockscout: 'https://base.blockscout.com',
    addrHint: 'BASE • 0x…',
  },
  filecoin: {
    id: 'filecoin',
    label: 'فایل‌کوین',
    short: 'FIL',
    native: 'FIL',
    color: '#0090FF',
    // glif public RPC — live-verified: eth_getBalance(0x…) (FEVM) and
    // Filecoin.WalletBalance(f1…) both work keyless.
    rpcs: ['https://api.node.glif.io/rpc/v1', 'https://rpc.filecoin.io'],
    addrHint: 'FIL • 0x… / f1…',
  },
  tron: {
    id: 'tron',
    label: 'ترون',
    short: 'TRON',
    native: 'TRX',
    color: '#E84142',
    rpcs: ['https://api.trongrid.io'],
    addrHint: 'TRON • T…',
  },
  bitcoin: {
    id: 'bitcoin',
    label: 'بیت‌کوین',
    short: 'BTC',
    native: 'BTC',
    color: '#F7931A',
    rpcs: [],
    addrHint: 'BTC • bc1… / 1…',
  },
  solana: {
    id: 'solana',
    label: 'سولانا',
    short: 'SOL',
    native: 'SOL',
    color: '#9945FF',
    rpcs: ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.com'],
    addrHint: 'SOL • base58',
  },
};

export const NETWORK_ORDER: BlockchainNetwork[] = [
  'ethereum',
  'bsc',
  'polygon',
  'arbitrum',
  'base',
  'filecoin',
  'tron',
  'bitcoin',
  'solana',
];

/** Networks sharing the 0x address format — any subset can be selected together. */
export const EVM_NETWORKS: BlockchainNetwork[] = [
  'ethereum',
  'bsc',
  'polygon',
  'arbitrum',
  'base',
  'filecoin',
];

export function isEvmNetwork(n: BlockchainNetwork): boolean {
  return n === 'ethereum' || n === 'bsc' || n === 'polygon' || n === 'arbitrum' || n === 'base' || n === 'filecoin';
}

// ---------------------------------------------------------------------------
// Curated TRC-20 tokens (contracts verified on-chain via symbol() calls)
// ---------------------------------------------------------------------------

export interface Trc20Token {
  symbol: string;
  name: string;
  /** base58 contract address on Tron. */
  contract: string;
  decimals: number;
  stable: boolean;
}

/**
 * v1.4.17 — contracts re-verified ON-CHAIN (symbol() + decimals()) via
 * TronGrid; addresses sourced from CoinGecko platforms.
 */
export const CURATED_TRC20: Trc20Token[] = [
  {
    symbol: 'USDT',
    name: 'تتر (TRC-20)',
    contract: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    decimals: 6,
    stable: true,
  },
  {
    symbol: 'USDC',
    name: 'یو‌اس‌دی‌کوین (TRC-20)',
    contract: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8',
    decimals: 6,
    stable: true,
  },
  {
    symbol: 'stUSDT',
    name: 'stUSDT (TRC-20)',
    contract: 'TThzxNRLrW2Brp9DcTQU8i4Wd9udCWEdZ3',
    decimals: 18,
    stable: true,
  },
  {
    symbol: 'JST',
    name: 'JUST (TRC-20)',
    contract: 'TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9',
    decimals: 18,
    stable: false,
  },
  {
    symbol: 'SUN',
    name: 'SUN (TRC-20)',
    contract: 'TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S',
    decimals: 18,
    stable: false,
  },
  {
    symbol: 'WIN',
    name: 'WINkLink (TRC-20)',
    contract: 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7',
    decimals: 6,
    stable: false,
  },
];

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const WALLETS_KEY = '@blockchain_wallets_v1';
const BALANCE_CACHE_KEY = '@blockchain_balance_cache_v1';

const ALL_NETWORK_IDS = new Set<string>(NETWORK_ORDER);

/** v1.4.16 wallets had a single `network` — migrate them to `networks: [network]`. */
function migrateWallet(raw: unknown): BlockchainWallet | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : '';
  const address = typeof r.address === 'string' ? r.address : '';
  if (!id || !address) return null;
  let networks: string[] = [];
  if (Array.isArray(r.networks)) {
    networks = r.networks.map(String).filter((n) => ALL_NETWORK_IDS.has(n));
  }
  if (networks.length === 0 && typeof r.network === 'string' && ALL_NETWORK_IDS.has(r.network)) {
    networks = [r.network];
  }
  if (networks.length === 0) networks = ['ethereum'];
  return {
    id,
    name: typeof r.name === 'string' && r.name ? r.name : 'کیف پول',
    address,
    networks: [...new Set(networks)] as BlockchainNetwork[],
    addedAt: typeof r.addedAt === 'number' ? r.addedAt : Date.now(),
  };
}

export async function loadBlockchainWallets(): Promise<BlockchainWallet[]> {
  try {
    const raw = await AsyncStorage.getItem(WALLETS_KEY);
    if (raw) {
      const list = JSON.parse(raw) as unknown[];
      if (Array.isArray(list)) {
        return list.map(migrateWallet).filter((w): w is BlockchainWallet => w !== null);
      }
    }
  } catch {}
  return [];
}

export async function saveBlockchainWallets(wallets: BlockchainWallet[]): Promise<void> {
  try {
    await AsyncStorage.setItem(WALLETS_KEY, JSON.stringify(wallets));
  } catch {}
}

export async function readBlockchainBalanceCache(
  id: string
): Promise<BlockchainWalletData | null> {
  try {
    const raw = await AsyncStorage.getItem(BALANCE_CACHE_KEY);
    if (raw) {
      const map = JSON.parse(raw) as Record<string, BlockchainWalletData>;
      return map[id] ?? null;
    }
  } catch {}
  return null;
}

export async function writeBlockchainBalanceCache(data: BlockchainWalletData): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(BALANCE_CACHE_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, BlockchainWalletData>) : {};
    map[data.walletId] = data;
    await AsyncStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify(map));
  } catch {}
}

export async function removeBlockchainBalanceCache(id: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(BALANCE_CACHE_KEY);
    if (!raw) return;
    const map = JSON.parse(raw) as Record<string, BlockchainWalletData>;
    delete map[id];
    await AsyncStorage.setItem(BALANCE_CACHE_KEY, JSON.stringify(map));
  } catch {}
}

// ---------------------------------------------------------------------------
// Address validation (per network) + multi-network detection
// ---------------------------------------------------------------------------

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]+$/;

/**
 * Base58check decode with double-SHA256 checksum verify (Tron).
 * Returns the 21-byte hex form (0x41 + 20 bytes) that TronGrid accepts,
 * or null when the address fails format/checksum.
 */
function tronAddressToHex(addr: string): string | null {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr)) return null;
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  try {
    const zeros = addr.length - addr.replace(/^1+/, '').length;
    let n = 0n;
    for (const c of addr) {
      const idx = ALPHABET.indexOf(c);
      if (idx < 0) return null;
      n = n * 58n + BigInt(idx);
    }
    let hex = n.toString(16);
    if (hex.length % 2) hex = '0' + hex;
    hex = '00'.repeat(zeros) + hex;
    if (hex.length !== 50) return null; // 25 bytes: 0x41 + 20 + 4 checksum
    const payload = hex.slice(0, 42);
    if (!payload.startsWith('41')) return null;
    // verify the double-SHA256 checksum over the 21 payload bytes
    const words: number[] = new Array(6).fill(0);
    for (let i = 0; i < 21; i++) {
      const b = parseInt(payload.slice(i * 2, i * 2 + 2), 16);
      words[i >> 2] |= b << (24 - 8 * (i & 3));
    }
    const wa = CryptoJS.lib.WordArray.create(words, 21);
    const hash = CryptoJS.SHA256(CryptoJS.SHA256(wa)).toString();
    if (hash.slice(0, 8) !== hex.slice(42)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function validateBlockchainAddress(
  network: BlockchainNetwork,
  address: string
): { ok: boolean; message?: string } {
  const a = address.trim();
  if (!a) return { ok: false, message: 'آدرس را وارد کنید' };
  switch (network) {
    case 'ethereum':
    case 'bsc':
    case 'polygon':
    case 'arbitrum':
    case 'base': {
      if (!/^0x[0-9a-fA-F]{40}$/.test(a)) {
        return { ok: false, message: 'آدرس EVM معتبر نیست — باید با 0x شروع شود و ۴۲ کاراکتر باشد' };
      }
      return { ok: true };
    }
    case 'filecoin': {
      // FEVM uses the same 0x format; native Filecoin uses f1/f2/f3/f4 base32.
      if (/^0x[0-9a-fA-F]{40}$/.test(a)) return { ok: true };
      if (/^f[1-4][a-z2-7]{8,58}$/.test(a)) return { ok: true };
      return {
        ok: false,
        message: 'آدرس فایل‌کوین معتبر نیست — باید 0x (شبکه اتریومی فایل‌کوین) یا f1 شروع شود',
      };
    }
    case 'tron': {
      if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) {
        return { ok: false, message: 'آدرس ترون معتبر نیست — با T شروع می‌شود و ۳۴ کاراکتر دارد' };
      }
      if (tronAddressToHex(a) === null) {
        return { ok: false, message: 'چک‌سام آدرس ترون نامعتبر است — آدرس را دوباره کپی کنید' };
      }
      return { ok: true };
    }
    case 'bitcoin': {
      if (/^(bc1)[02-9ac-hj-np-z]{11,71}$/i.test(a) || /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a)) {
        return { ok: true };
      }
      return { ok: false, message: 'آدرس بیت‌کوین معتبر نیست — باید با bc1 یا 1 یا 3 شروع شود' };
    }
    case 'solana': {
      if (a.length >= 32 && a.length <= 44 && BASE58_RE.test(a)) return { ok: true };
      return { ok: false, message: 'آدرس سولانا معتبر نیست (۳۲ تا ۴۴ کاراکتر base58)' };
    }
  }
}

/** Address format family — which networks an address is compatible with. */
export type AddressKind = 'evm' | 'tron' | 'bitcoin' | 'solana' | 'fil-native' | null;

/**
 * Detects the address format family from the raw string — drives the
 * multi-select network picker in the add form.
 */
export function detectAddressKind(address: string): AddressKind {
  const a = address.trim();
  if (!a) return null;
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return 'evm';
  if (/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(a)) return 'tron';
  if (/^(bc1)[02-9ac-hj-np-z]{11,71}$/i.test(a) || /^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(a)) {
    return 'bitcoin';
  }
  // Filecoin native: f1/f3/f4 + base32 (lowercase, no 0/1/8/9) payload+checksum.
  if (/^f[1-4][a-z2-7]{8,58}$/.test(a)) return 'fil-native';
  if (a.length >= 32 && a.length <= 44 && BASE58_RE.test(a)) return 'solana';
  return null;
}

/** Networks the given address-kind can be read on. */
export function compatibleNetworksFor(kind: AddressKind): BlockchainNetwork[] {
  switch (kind) {
    case 'evm':
      return EVM_NETWORKS;
    case 'tron':
      return ['tron'];
    case 'bitcoin':
      return ['bitcoin'];
    case 'solana':
      return ['solana'];
    case 'fil-native':
      return ['filecoin'];
    default:
      return [];
  }
}

/** Persian description of an address kind (shown under the address input). */
export function addressKindLabel(kind: AddressKind): string {
  switch (kind) {
    case 'evm':
      return 'آدرس اتریومی (0x) — در همه شبکه‌های اتریوم‌مانند یکسان است';
    case 'tron':
      return 'آدرس ترون (TRC)';
    case 'bitcoin':
      return 'آدرس بیت‌کوین';
    case 'solana':
      return 'آدرس سولانا';
    case 'fil-native':
      return 'آدرس اصلی فایل‌کوین (f1)';
    default:
      return '';
  }
}

/** Default selection when an address of this kind is pasted (read everything). */
export function defaultNetworksFor(kind: AddressKind): BlockchainNetwork[] {
  return compatibleNetworksFor(kind);
}

/** «ETH+BNB+FIL» label for chips/rows. */
export function networksShortLabel(networks: BlockchainNetwork[]): string {
  if (networks.length === 0) return '—';
  return networks.map((n) => NETWORKS[n].short).join('+');
}

/** Tron hex form (21 bytes, no checksum) for TronGrid calls — null if invalid. */
export function tronHexAddress(addr: string): string | null {
  return tronAddressToHex(addr);
}

/** Shortened address for display: 0x71C7…9A3f */
export function shortAddress(address: string): string {
  const a = address.trim();
  if (a.length <= 14) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

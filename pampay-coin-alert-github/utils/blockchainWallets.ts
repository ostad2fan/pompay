import AsyncStorage from '@react-native-async-storage/async-storage';
import CryptoJS from 'crypto-js';

/**
 * blockchainWallets.ts — v1.4.16
 *
 * Types + storage for the «کیف پول بلاکچین (فقط خواندنی)» 4th tab.
 *
 * A blockchain wallet entry is NOTHING but a PUBLIC address on one network —
 * no private key, no seed phrase, no credentials of any kind. Balances are
 * read from public keyless explorers/RPCs (blockchainWalletApi.ts).
 *
 * Supported networks (all verified keyless):
 *   EVM  — Ethereum / BNB Chain / Polygon / Arbitrum / Base
 *           (Blockscout API v2 token-balances + public RPC fallback)
 *   Tron — TronGrid (TRX + curated TRC-20: USDT/USDC verified on-chain)
 *   Bitcoin — mempool.space + blockstream.info fallback
 *   Solana — public RPC + Jupiter price API
 */

export type BlockchainNetwork =
  | 'ethereum'
  | 'bsc'
  | 'polygon'
  | 'arbitrum'
  | 'base'
  | 'tron'
  | 'bitcoin'
  | 'solana';

export interface BlockchainWallet {
  id: string;
  /** User-chosen display name, e.g. «تراست ولتم — کیف اصلی». */
  name: string;
  network: BlockchainNetwork;
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
    rpcs: ['https://eth.llamarpc.ai', 'https://rpc.ankr.com/eth', 'https://cloudflare-eth.com'],
    blockscout: 'https://eth.blockscout.com',
    addrHint: 'ETH • 0x…',
  },
  bsc: {
    id: 'bsc',
    label: 'BNB Chain',
    short: 'BNB',
    native: 'BNB',
    color: '#F0B90B',
    rpcs: ['https://bsc-dataseed.binance.org', 'https://bsc-dataseed1.defibit.io'],
    addrHint: 'BSC • 0x…',
  },
  polygon: {
    id: 'polygon',
    label: 'پالیگان',
    short: 'POL',
    native: 'POL',
    color: '#8247E5',
    rpcs: ['https://polygon-rpc.com', 'https://rpc.ankr.com/polygon'],
    blockscout: 'https://polygon.blockscout.com',
    addrHint: 'POL • 0x…',
  },
  arbitrum: {
    id: 'arbitrum',
    label: 'آربیتروم',
    short: 'ARB',
    native: 'ETH',
    color: '#28A0F0',
    rpcs: ['https://arb1.arbitrum.io/rpc', 'https://rpc.ankr.com/arbitrum'],
    blockscout: 'https://arbitrum.blockscout.com',
    addrHint: 'ARB • 0x…',
  },
  base: {
    id: 'base',
    label: 'بیس',
    short: 'BASE',
    native: 'ETH',
    color: '#0052FF',
    rpcs: ['https://mainnet.base.org', 'https://rpc.ankr.com/base'],
    blockscout: 'https://base.blockscout.com',
    addrHint: 'BASE • 0x…',
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
  'tron',
  'bitcoin',
  'solana',
];

// ---------------------------------------------------------------------------
// Curated TRC-20 tokens (contracts VERIFIED on-chain via symbol() calls)
// ---------------------------------------------------------------------------

export interface Trc20Token {
  symbol: string;
  name: string;
  /** base58 contract address on Tron. */
  contract: string;
  decimals: number;
  stable: boolean;
}

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
];

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const WALLETS_KEY = '@blockchain_wallets_v1';
const BALANCE_CACHE_KEY = '@blockchain_balance_cache_v1';

export async function loadBlockchainWallets(): Promise<BlockchainWallet[]> {
  try {
    const raw = await AsyncStorage.getItem(WALLETS_KEY);
    if (raw) {
      const list = JSON.parse(raw) as BlockchainWallet[];
      if (Array.isArray(list)) return list;
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
// Address validation (per network)
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
    // Tron addresses never start with '1' (version byte 0x41), but keep the
    // general base58 leading-zeros rule anyway.
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

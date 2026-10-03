/**
 * appUpdate.ts — in-app version check + direct APK download.
 *
 * The GitHub repository (ostad2fan/pompay) ships two extra files under
 * pampay-coin-alert-github/apk/:
 *   apk/version.json             → {"latestVersion":"1.4.3","versionCode":8,"apkUrl":"...","notes":"..."}
 *   apk/PampDumpCoins-latest.apk → the newest signed APK (fixed filename!)
 *
 * v1.4.3: the check now tries MULTIPLE mirrors in order, because
 * raw.githubusercontent.com is blocked on many Iranian ISPs without a VPN:
 *   1. The project's own Railway server (relay endpoint /latest-version)
 *   2. jsDelivr CDN (cdn.jsdelivr.net + fastly.jsdelivr.net) — GitHub mirror
 *   3. raw.githubusercontent.com — the direct GitHub file
 * The APK download also falls back across mirrors (jsDelivr first, then raw,
 * then the Railway relay) so the update installs even without a VPN.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';
import { getServerUrl } from './scanServerApi';

/** Must match app.json «version» at release time. */
export const APP_VERSION = '1.4.10';
export const APP_VERSION_CODE = 15;

const REPO_OWNER = 'ostad2fan';
const REPO_NAME = 'pompay';
const REPO_BRANCH = 'main';
const REPO_DIR = 'pampay-coin-alert-github';
const APK_NAME = 'PampDumpCoins-latest.apk';
/**
 * v1.4.10 — the APK now ALSO ships under a VERSIONED name
 * (PampDumpCoins-v1.4.10.apk). The versioned URL is the primary download
 * because it can NEVER collide with a cached older file: every release is a
 * brand-new URL, so the browser/DownloadManager cannot serve the previous
 * version «by mistake» (the #1 cause of «دکمه دانلود نسخه قدیمی می‌آورد» —
 * jsDelivr sends cache-control max-age=604800 = 7 days on the fixed name).
 * The fixed-name copy stays in the repo as a fallback for older app builds.
 */
const VERSIONED_APK_NAME = `PampDumpCoins-v${APP_VERSION}.apk`;

/** Direct GitHub raw URL for version.json (blocked in Iran without VPN). */
export const DEFAULT_UPDATE_URL =
  `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/${REPO_DIR}/apk/version.json`;

/** jsDelivr CDN mirrors of the same file (accessible from Iran). */
const VERSION_MIRRORS = [
  `https://cdn.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@${REPO_BRANCH}/${REPO_DIR}/apk/version.json`,
  `https://fastly.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@${REPO_BRANCH}/${REPO_DIR}/apk/version.json`,
];

const UPDATE_URL_KEY = '@app_update_check_url';
const DISMISSED_KEY = '@app_update_dismissed_version';

export interface AppUpdateInfo {
  available: boolean;
  latestVersion: string;
  versionCode?: number;
  apkUrl: string;
  notes?: string;
  checkedAt: number;
  /** Which mirror answered — shown in the settings status line. */
  source?: string;
}

/** Last check failure reason (for the settings error line). */
export let lastUpdateError: string | null = null;

type UpdateListener = (info: AppUpdateInfo | null) => void;
const listeners = new Set<UpdateListener>();

/** Subscribe to update-info changes (banner, settings page…). */
export function onUpdateInfoChanged(listener: UpdateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitUpdateInfo(info: AppUpdateInfo | null): void {
  listeners.forEach((l) => {
    try {
      l(info);
    } catch {}
  });
}

/** Installed (running) version — expo-constants embeds app.json at build time. */
export function getInstalledVersion(): string {
  try {
    return Constants.expoConfig?.version ?? APP_VERSION;
  } catch {
    return APP_VERSION;
  }
}

/** -1 / 0 / +1 — numeric-aware semver comparison ("1.10.0" > "1.9.0"). */
export function compareVersions(a: string, b: string): number {
  const pa = String(a ?? '')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const pb = String(b ?? '')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export async function getUpdateCheckUrl(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem(UPDATE_URL_KEY);
    if (stored && /^https?:\/\//i.test(stored.trim())) return stored.trim();
  } catch {}
  return DEFAULT_UPDATE_URL;
}

export async function setUpdateCheckUrl(url: string): Promise<void> {
  const clean = url.trim();
  if (!/^https?:\/\//i.test(clean)) throw new Error('آدرس باید با http یا https شروع شود');
  await AsyncStorage.setItem(UPDATE_URL_KEY, clean);
}

/** Ordered candidate URLs for version.json (user override → server relay → CDNs → raw GitHub). */
async function versionCheckCandidates(): Promise<string[]> {
  const urls: string[] = [];
  try {
    const stored = await AsyncStorage.getItem(UPDATE_URL_KEY);
    if (stored && /^https?:\/\//i.test(stored.trim())) urls.push(stored.trim());
  } catch {}
  try {
    const serverUrl = await getServerUrl();
    if (serverUrl) urls.push(`${serverUrl}/latest-version`);
  } catch {}
  urls.push(...VERSION_MIRRORS);
  if (!urls.includes(DEFAULT_UPDATE_URL)) urls.push(DEFAULT_UPDATE_URL);
  return urls;
}

interface RawVersionJson {
  latestVersion?: string;
  version?: string;
  versionCode?: number;
  apkUrl?: string;
  url?: string;
  notes?: string;
}

/** Fetch one URL and parse version.json. Throws on network/parse errors. */
async function fetchVersionJson(url: string): Promise<RawVersionJson> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    // v1.4.10 — cache-buster: CDNs and the Android WebView otherwise keep
    // answering from cache for hours after a release, so the app would think
    // it is up-to-date (or re-download an old APK).
    const bust = url.includes('?') ? '&' : '?';
    const res = await fetch(`${url}${bust}t=${Date.now()}`, {
      headers: { 'Cache-Control': 'no-cache', Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as RawVersionJson;
  } finally {
    clearTimeout(timer);
  }
}

function mirrorLabel(url: string): string {
  if (url.includes('/latest-version')) return 'سرور برنامه';
  if (url.includes('jsdelivr')) return 'CDN jsDelivr';
  if (url.includes('raw.githubusercontent')) return 'گیت‌هاب';
  return 'آدرس سفارشی';
}

/** Fetch + parse version.json (multi-mirror) and decide whether an update is available. */
export async function fetchUpdateInfo(urlOverride?: string): Promise<AppUpdateInfo | null> {
  const candidates = urlOverride ? [urlOverride] : await versionCheckCandidates();
  lastUpdateError = null;

  for (const url of candidates) {
    if (!/^https?:\/\//i.test(url)) continue;
    try {
      const data = await fetchVersionJson(url);
      const latestVersion = String(data.latestVersion ?? data.version ?? '').trim();
      const apkUrl = String(data.apkUrl ?? data.url ?? '').trim();
      if (!latestVersion || !apkUrl) throw new Error('bad version.json');
      const installed = getInstalledVersion();
      const info: AppUpdateInfo = {
        available: compareVersions(latestVersion, installed) > 0,
        latestVersion,
        versionCode: typeof data.versionCode === 'number' ? data.versionCode : undefined,
        apkUrl,
        notes: typeof data.notes === 'string' ? data.notes : undefined,
        checkedAt: Date.now(),
        source: mirrorLabel(url),
      };
      emitUpdateInfo(info);
      return info;
    } catch (e) {
      console.log(`[AppUpdate] check failed via ${url}:`, e instanceof Error ? e.message : e);
    }
  }

  lastUpdateError =
    'هیچ‌کدام از مسیرهای بررسی (سرور برنامه، CDN و گیت‌هاب) پاسخ ندادند — اینترنت گوشی را چک کنید';
  emitUpdateInfo(null);
  return null;
}

/** Has the user dismissed the banner for this specific version? */
export async function isUpdateDismissed(version: string): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(DISMISSED_KEY)) === version;
  } catch {
    return false;
  }
}

/** Stop showing the banner for this version (a newer one will re-show). */
export async function dismissUpdate(version: string): Promise<void> {
  try {
    await AsyncStorage.setItem(DISMISSED_KEY, version);
  } catch {}
}

/** The versioned (primary) and fixed-name (fallback) raw/CDN APK URLs. */
function apkDownloadCandidates(apkUrl: string): string[] {
  // Always start from the URL version.json gave us (versioned name since
  // v1.4.10) + cache-buster so no layer can serve a stale copy.
  const bust = (u: string) => `${u}${u.includes('?') ? '&' : '?'}v=${APP_VERSION_CODE}-${Date.now()}`;
  const urls = [bust(apkUrl)];
  const rawVersioned = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/${REPO_DIR}/apk/${VERSIONED_APK_NAME}`;
  const cdnVersioned = `https://cdn.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@${REPO_BRANCH}/${REPO_DIR}/apk/${VERSIONED_APK_NAME}`;
  const fastlyVersioned = `https://fastly.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@${REPO_BRANCH}/${REPO_DIR}/apk/${VERSIONED_APK_NAME}`;
  if (!/raw\.githubusercontent\.com/.test(apkUrl)) {
    // CDN first (Iran-friendly), then raw, then fastly — all versioned.
    urls.push(bust(cdnVersioned), bust(rawVersioned), bust(fastlyVersioned));
  } else {
    urls.push(bust(cdnVersioned), bust(fastlyVersioned));
  }
  // Last resorts: the fixed-name mirrors (kept in sync in the repo) + relay.
  const raw = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/${REPO_DIR}/apk/${APK_NAME}`;
  const cdn = `https://cdn.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@${REPO_BRANCH}/${REPO_DIR}/apk/${APK_NAME}`;
  const fastly = `https://fastly.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@${REPO_BRANCH}/${REPO_DIR}/apk/${APK_NAME}`;
  for (const alt of [cdn, raw, fastly]) {
    if (!urls.some((u) => u.startsWith(alt))) urls.push(bust(alt));
  }
  return urls;
}

/** File name the browser will save — with the version visible. */
export function apkFileNameFor(info: { latestVersion?: string } | null | undefined): string {
  const v = info?.latestVersion ?? APP_VERSION;
  return `PampDumpCoins-v${v}.apk`;
}

/**
 * Opens the APK URL → the browser downloads the file directly. The download
 * filename carries the version (PampDumpCoins-v1.4.10.apk) and every URL
 * gets a cache-buster so no cached older APK can ever be served. Falls back
 * through the mirrors (ending with the Railway server relay) when a URL
 * cannot be opened at all.
 */
export async function openApkDownload(apkUrl: string): Promise<void> {
  const candidates = [...apkDownloadCandidates(apkUrl)];
  try {
    const serverUrl = await getServerUrl();
    if (serverUrl) candidates.push(`${serverUrl}/latest-apk`);
  } catch {}
  let lastError: unknown = null;
  for (const url of candidates) {
    try {
      if (Platform.OS === 'web') {
        window.open(url, '_blank');
        return;
      }
      await Linking.openURL(url);
      return;
    } catch (e) {
      lastError = e;
      console.log(`[AppUpdate] openURL failed for ${url}`);
    }
  }
  if (lastError) throw lastError;
}

/** Human-readable last-check error (settings page). */
export function getLastUpdateError(): string | null {
  return lastUpdateError;
}

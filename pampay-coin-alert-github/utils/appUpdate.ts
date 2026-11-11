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
export const APP_VERSION = '1.5.21';
export const APP_VERSION_CODE = 46;

const REPO_OWNER = 'ostad2fan';
const REPO_NAME = 'pompay';
const REPO_BRANCH = 'main';
const REPO_DIR = 'pampay-coin-alert-github';
const APK_NAME = 'PampDumpCoins-latest.apk';

/**
 * v1.5.15 — CRITICAL FIX for «دکمه دانلود نسخه قدیمی می‌آورد»:
 * these URL builders MUST be derived from the LATEST version (from
 * version.json / the apkUrl itself), NEVER from the installed APP_VERSION.
 * Before this fix `RELEASE_APK_URL` was built with APP_VERSION (the version
 * running on the phone) and `apkDownloadCandidates` put it IN FRONT of the
 * manifest apkUrl — so a user on 1.5.13 pressing «بروزرسانی» got the 1.5.13
 * release asset (which exists!) instead of 1.5.14. Now every candidate is
 * computed from the version embedded in the manifest apkUrl.
 */
function versionedApkName(v: string): string {
  return `PampDumpCoins-v${v}.apk`;
}

function releaseApkUrlFor(v: string): string {
  return `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/v${v}/${versionedApkName(v)}`;
}

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
  if (url.includes('api.github.com')) return 'گیت‌هاب (ریلیز)';
  if (url.includes('jsdelivr')) return 'CDN jsDelivr';
  if (url.includes('raw.githubusercontent')) return 'گیت‌هاب';
  return 'آدرس سفارشی';
}

/**
 * v1.5.16 — منبع اولِ بررسی: خود API گیت‌هاب (releases/latest). این پاسخ
 * همیشه آخرین ریلیز واقعی است و هیچ کش CDN وسطش نیست — پس «همیشه آخرین
 * نسخه از ریلیز» تضمین می‌شود. اگر api.github.com در دسترس نبود (بلاک/کند —
 * تایم‌اوت ۴ ثانیه)، زنجیرهٔ قبلی (سرور برنامه → CDN → raw) همان کار را
 * انجام می‌دهد.
 */
async function fetchLatestReleaseViaApi(): Promise<RawVersionJson | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal }
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      tag_name?: string;
      body?: string;
      assets?: Array<{ name?: string; browser_download_url?: string }>;
    };
    const tag = String(j.tag_name ?? '')
      .trim()
      .replace(/^v/i, '');
    const asset = Array.isArray(j.assets)
      ? j.assets.find((a) => /\.apk$/i.test(String(a.name ?? '')))
      : undefined;
    if (!tag || !asset?.browser_download_url) return null;
    return {
      latestVersion: tag,
      apkUrl: String(asset.browser_download_url),
      notes: j.body ? String(j.body).slice(0, 600) : undefined,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch + parse version.json (multi-mirror) and decide whether an update is available. */
export async function fetchUpdateInfo(urlOverride?: string): Promise<AppUpdateInfo | null> {
  const candidates = urlOverride ? [urlOverride] : await versionCheckCandidates();
  lastUpdateError = null;

  // v1.5.16 — اول از خود ریلیزِ گیت‌هاب (بدون کش)، بعد زنجیرهٔ مانیفست‌ها
  if (!urlOverride) {
    const viaApi = await fetchLatestReleaseViaApi();
    if (viaApi) {
      const latestVersion = String(viaApi.latestVersion).trim();
      const apkUrl = String(viaApi.apkUrl).trim();
      const info: AppUpdateInfo = {
        available: compareVersions(latestVersion, getInstalledVersion()) > 0,
        latestVersion,
        apkUrl,
        notes: viaApi.notes,
        checkedAt: Date.now(),
        source: mirrorLabel('api.github.com'),
      };
      emitUpdateInfo(info);
      return info;
    }
  }

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
  // v1.5.15 — every candidate is built from the LATEST version, derived from
  // the manifest apkUrl itself (…/releases/download/v1.5.14/… or
  // PampDumpCoins-v1.5.14.apk). The installed APP_VERSION is only a last
  // fallback and can never come before the manifest URL.
  const fromUrl =
    apkUrl.match(/releases\/download\/v([^/?#]+)\//i)?.[1] ??
    apkUrl.match(/PampDumpCoins-v([0-9][0-9.]*)\.apk/i)?.[1] ??
    APP_VERSION;
  const latestV = fromUrl.trim() || APP_VERSION;

  // Cache-buster so no layer can serve a stale copy.
  const bust = (u: string) => `${u}${u.includes('?') ? '&' : '?'}v=${APP_VERSION_CODE}-${Date.now()}`;

  const urls: string[] = [bust(apkUrl)];
  const releaseUrl = releaseApkUrlFor(latestV);
  if (!urls[0].startsWith(releaseUrl)) urls.push(bust(releaseUrl));
  const rawVersioned = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/${REPO_DIR}/apk/${versionedApkName(latestV)}`;
  const cdnVersioned = `https://cdn.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@${REPO_BRANCH}/${REPO_DIR}/apk/${versionedApkName(latestV)}`;
  const fastlyVersioned = `https://fastly.jsdelivr.net/gh/${REPO_OWNER}/${REPO_NAME}@${REPO_BRANCH}/${REPO_DIR}/apk/${versionedApkName(latestV)}`;
  // CDN first (Iran-friendly), then raw, then fastly — all latest-versioned.
  urls.push(bust(cdnVersioned), bust(rawVersioned), bust(fastlyVersioned));
  // Last resorts: the fixed-name mirrors (kept in sync in the repo).
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
 * v1.5.10 — probe each candidate with a tiny ranged GET (2 bytes) and return
 * the first URL that really exists (HTTP 200/206). Fixes the observed
 * failure where the versioned APK file was not uploaded to GitHub: the
 * browser opened a 404 page and the fallback chain never ran, because
 * Linking.openURL only throws when NO handler exists — not when the file is
 * missing. Probing is capped (4s per URL, 20s total) so a blocked mirror can
 * never hang the download button.
 */
async function firstReachableUrl(urls: string[]): Promise<string | null> {
  const deadline = Date.now() + 20_000;
  for (const url of urls) {
    if (Date.now() > deadline) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4_000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Range: 'bytes=0-1', Accept: '*/*' },
        signal: controller.signal,
      });
      // 206 Partial Content or a plain 200 both mean the file exists.
      if (res.ok || res.status === 206) return url;
    } catch {
      // unreachable mirror → try the next candidate
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * Opens the APK URL → the browser downloads the file directly. The download
 * filename carries the version (PampDumpCoins-v1.4.10.apk) and every URL
 * gets a cache-buster so no cached older APK can ever be served. Falls back
 * through the mirrors (ending with the Railway server relay) when a URL
 * cannot be opened at all.
 *
 * v1.5.10: the first candidate that actually EXISTS is opened (a 2-byte
 * ranged GET probe), so a missing versioned APK on GitHub falls through to
 * the fixed-name mirror automatically — the browser can no longer land on a
 * dead 404 page.
 */
export async function openApkDownload(apkUrl: string): Promise<void> {
  const candidates = [...apkDownloadCandidates(apkUrl)];
  try {
    const serverUrl = await getServerUrl();
    if (serverUrl) candidates.push(`${serverUrl}/latest-apk`);
  } catch {}
  // v1.5.10 — pick the first URL that really exists. If probing is not
  // possible at all (no network / every mirror blocked), fall back to the
  // old behaviour and open the primary URL — the browser may still succeed
  // through its own network stack (e.g. with a VPN).
  let ordered = candidates;
  try {
    const reachable = await firstReachableUrl(candidates);
    if (reachable) ordered = [reachable, ...candidates.filter((u) => u !== reachable)];
  } catch {}
  let lastError: unknown = null;
  for (const url of ordered) {
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

/**
 * v1.5.15 — settings «بررسی بروزرسانی و دانلود» button: ALWAYS re-fetches
 * version.json fresh (no stored/stale info) and downloads the LATEST release
 * asset. The candidate list itself is derived from the manifest apkUrl, so a
 * user on an old build can never be handed his own (old) release again.
 */
export async function checkAndDownloadLatest(): Promise<AppUpdateInfo | null> {
  const fresh = await fetchUpdateInfo();
  if (!fresh) throw new Error(getLastUpdateError() ?? 'بررسی نسخه جدید ناموفق بود');
  await openApkDownload(fresh.apkUrl);
  return fresh;
}

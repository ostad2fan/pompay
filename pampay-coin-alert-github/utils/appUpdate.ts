/**
 * appUpdate.ts — in-app version check + direct APK download.
 *
 * The GitHub repository (ostad2fan/pompay) ships two extra files under
 * pampay-coin-alert-github/apk/:
 *   apk/version.json             → {"latestVersion":"1.3.0","versionCode":4,"apkUrl":"...","notes":"..."}
 *   apk/PampDumpCoins-latest.apk → the newest signed APK (fixed filename!)
 *
 * When a new version is released, the user only replaces the APK file (same
 * name) and bumps «latestVersion» in version.json — the app notices on the
 * next check and shows the update banner / blinking update button.
 *
 * The check URL is baked in below (raw GitHub file) — no user configuration
 * needed. Keeping the same keystore + same package name + a higher
 * versionCode lets the new APK install directly ON TOP of the old one.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';

/** Must match app.json «version» at release time. */
export const APP_VERSION = '1.4.2';
export const APP_VERSION_CODE = 7;

/**
 * Update-check URL — points at the raw version.json inside the public
 * GitHub repository of this project (ostad2fan/pompay).
 */
export const DEFAULT_UPDATE_URL =
  'https://raw.githubusercontent.com/ostad2fan/pompay/main/pampay-coin-alert-github/apk/version.json';

const UPDATE_URL_KEY = '@app_update_check_url';
const DISMISSED_KEY = '@app_update_dismissed_version';

export interface AppUpdateInfo {
  available: boolean;
  latestVersion: string;
  versionCode?: number;
  apkUrl: string;
  notes?: string;
  checkedAt: number;
}

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

/** Fetch + parse version.json and decide whether an update is available. */
export async function fetchUpdateInfo(urlOverride?: string): Promise<AppUpdateInfo | null> {
  const url = urlOverride ?? (await getUpdateCheckUrl());
  if (!/^https?:\/\//i.test(url)) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache', Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      latestVersion?: string;
      version?: string;
      versionCode?: number;
      apkUrl?: string;
      url?: string;
      notes?: string;
    };
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
    };
    emitUpdateInfo(info);
    return info;
  } catch (e) {
    console.log('[AppUpdate] check failed:', e);
    emitUpdateInfo(null);
    return null;
  }
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

/** Open the APK URL → the browser downloads the file directly. */
export async function openApkDownload(apkUrl: string): Promise<void> {
  if (Platform.OS === 'web') {
    window.open(apkUrl, '_blank');
    return;
  }
  await Linking.openURL(apkUrl);
}

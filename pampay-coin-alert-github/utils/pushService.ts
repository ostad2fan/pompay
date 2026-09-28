import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getServerUrl } from './scanServerApi';

/**
 * pushService — native push registration bridge.
 *
 * Primary channel for "app closed" alerts is the Telegram bot (server-side),
 * this adds a second channel:
 *  - Expo Push token  →  server broadcasts via Expo push service
 *  - FCM token (bare APK builds with google-services.json)
 *
 * All failures are non-fatal: the app keeps working with Telegram only.
 */

const PUSH_TOKEN_KEY = '@push_token_cached';
const PUSH_REGISTERED_KEY = '@push_registered_on_server';

/**
 * Expo project UUID (from app.json extra.eas.projectId).
 * Hardcoded as a runtime fallback for builds where Constants.expoConfig
 * is unavailable — the app.config asset embeds it automatically at build time.
 */
const FALLBACK_EXPO_PROJECT_ID = '859ac9be-21fe-4e83-9905-14c017c0eb87';

export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    const current = await Notifications.getPermissionsAsync();
    let granted = current.granted || current.status === 'granted';
    if (!granted) {
      const req = await Notifications.requestPermissionsAsync();
      granted = req.granted || req.status === 'granted';
    }
    if (!granted) return false;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('signals', {
        name: 'سیگنال‌ها',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#0088cc',
      });
    }
    return true;
  } catch (e) {
    console.log('[Push] permission error:', e);
    return false;
  }
}

/**
 * Gets an Expo push token (ExponentPushToken[...]).
 *
 * Uses the proper getExpoPushTokenAsync API — the previous implementation
 * called getDevicePushTokenAsync() which returns a raw FCM token the server
 * rejects (it expects the ExponentPushToken prefix).
 *
 * Requires extra.eas.projectId in app.json (see docs/03-PUSH-NOTIFICATIONS.md)
 * and a build with FCM (google-services.json). When unavailable it returns
 * null and the Telegram bot remains the "app closed" notification channel.
 */
export async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const projectId =
      (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId ??
      FALLBACK_EXPO_PROJECT_ID;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (token) {
      await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
      return token;
    }
    return null;
  } catch (e) {
    console.log('[Push] token error:', e);
    return null;
  }
}

/** Registers the device token with the scanner server (POST /push/register). */
export async function registerPushOnServer(): Promise<boolean> {
  try {
    const serverUrl = await getServerUrl();
    if (!serverUrl) return false;
    const token = await getExpoPushToken();
    if (!token) return false;

    const res = await fetch(`${serverUrl}/push/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, platform: Platform.OS }),
    });
    if (res.ok) {
      await AsyncStorage.setItem(PUSH_REGISTERED_KEY, '1');
      console.log('[Push] registered on server');
      return true;
    }
    return false;
  } catch (e) {
    console.log('[Push] register error:', e);
    return false;
  }
}

export async function unregisterPushOnServer(): Promise<boolean> {
  try {
    const serverUrl = await getServerUrl();
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (!serverUrl || !token) return false;
    const res = await fetch(`${serverUrl}/push/unregister`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (res.ok) {
      await AsyncStorage.removeItem(PUSH_REGISTERED_KEY);
      return true;
    }
    return false;
  } catch (e) {
    console.log('[Push] unregister error:', e);
    return false;
  }
}

export async function getCachedPushToken(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Fires an immediate LOCAL notification (no FCM/Expo servers involved).
 * Used from Settings to verify that permissions + the "signals" channel work.
 */
export async function sendTestLocalNotification(): Promise<boolean> {
  try {
    const granted = await ensureNotificationPermission();
    if (!granted) return false;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '🔔 تست نوتیفیکیشن PomPay',
        body: 'اگر این پیام را می‌بینید، اعلان‌های برنامه روی گوشی شما فعال است.',
        sound: 'default',
      },
      trigger: null,
    });
    return true;
  } catch (e) {
    console.log('[Push] test notification error:', e);
    return false;
  }
}

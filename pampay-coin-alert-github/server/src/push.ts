// server/src/push.ts
// Expo push notification sender. The Android app registers its ExpoPushToken
// here (POST /push/register) and every new scan signal is pushed to all
// registered devices — this is what makes notifications arrive even when the
// app is fully closed (delivered by Google FCM through Expo's push service).
//
// Optional env vars:
//   EXPO_ACCESS_TOKEN  — Expo account access token (recommended, raises limits)
//   EXPO_PROJECT_ID    — not required for sending, used only for reference

import store from "./store";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const MAX_TOKENS = 50;

export interface StoredPushToken {
  token: string;
  registeredAt: number;
  lastSeenAt: number;
}

async function getTokens(): Promise<StoredPushToken[]> {
  return (await store.get<StoredPushToken[]>("pushTokens")) ?? [];
}

export async function registerPushToken(rawToken: string): Promise<{ ok: boolean; error?: string; count: number }> {
  const token = String(rawToken ?? "").trim();
  if (!token || !token.startsWith("ExponentPushToken")) {
    return { ok: false, error: "invalid token", count: (await getTokens()).length };
  }
  const tokens = await getTokens();
  const existing = tokens.find((t) => t.token === token);
  if (existing) {
    existing.lastSeenAt = Date.now();
  } else {
    tokens.push({ token, registeredAt: Date.now(), lastSeenAt: Date.now() });
  }
  // Keep the most recently registered tokens.
  const bounded = tokens.slice(-MAX_TOKENS);
  await store.put("pushTokens", bounded);
  console.log(`[Push] registered token (${bounded.length} total)`);
  return { ok: true, count: bounded.length };
}

export async function unregisterPushToken(rawToken: string): Promise<{ ok: boolean; count: number }> {
  const token = String(rawToken ?? "").trim();
  const tokens = await getTokens();
  const filtered = tokens.filter((t) => t.token !== token);
  await store.put("pushTokens", filtered);
  return { ok: true, count: filtered.length };
}

export async function pushStatus(): Promise<{ count: number; configured: boolean }> {
  const tokens = await getTokens();
  return {
    count: tokens.length,
    configured: Boolean(process.env.EXPO_ACCESS_TOKEN) || tokens.length > 0,
  };
}

interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

/** Sends a push to every registered device. Never throws. */
export async function sendPushToAll(title: string, body: string, data?: Record<string, unknown>): Promise<void> {
  try {
    const tokens = await getTokens();
    if (tokens.length === 0) return;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/json",
    };
    if (process.env.EXPO_ACCESS_TOKEN) {
      headers["Authorization"] = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
    }

    const messages = tokens.map((t) => ({
      to: t.token,
      title,
      body,
      data: data ?? {},
      sound: "default",
      channelId: "signals",
      priority: "high",
    }));

    // Expo push API accepts batches of up to 100 messages.
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(batch),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.log(`[Push] send failed: ${res.status} ${text.slice(0, 300)}`);
      } else {
        const json = (await res.json()) as { data?: { status: string; message?: string }[] };
        const statuses = json.data?.map((d) => d.status).join(",") ?? "?";
        console.log(`[Push] sent batch of ${batch.length}: ${statuses}`);
        // Drop tokens that Expo reports as invalid (device not registered).
        const bad = new Set(
          (json.data ?? [])
            .map((d, idx) => ({ d, token: batch[idx]?.to }))
            .filter((x) => x.d?.status === "error" && /not registered|DeviceNotRegistered/i.test(x.d.message ?? ""))
            .map((x) => x.token)
        );
        if (bad.size > 0) {
          const remaining = (await getTokens()).filter((t) => !bad.has(t.token));
          await store.put("pushTokens", remaining);
          console.log(`[Push] removed ${bad.size} dead token(s)`);
        }
      }
    }
  } catch (e) {
    console.log("[Push] error:", e);
  }
}

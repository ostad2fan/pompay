import { Tabs, useRouter, useRootNavigationState } from 'expo-router';
import { Radar, Settings, Fish, Wallet, Brain, Skull, Rocket, TrendingUp } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import colors from '@/constants/colors';

/**
 * v1.5.4 — «وقتی برنامه باز میشه صفحه پیش فرض همیشه روی تب تنظیمات باشه».
 * سه لایه محکم (کاربر هنوز گاهی روی اسکنر دامپ‌وپامپ فرود می‌آمد):
 *   ۱) initialRouteName="settings" (شروع معمول)
 *   ۲) app/+native-intent.tsx مسیر «/» را به «/settings» هدایت می‌کند
 *   ۳) پس از آماده شدن ناوبری ریشه، یک‌بار در هر اجرای برنامه اگر چراغ
 *      روی صفحه‌ای جز تنظیمات روشن باشد (بازگردانی state اندروید)، به
 *      تنظیمات برگردانده می‌شود (ماژول-level flag تا با تعویض تم دوباره
 *      اجرا نشود).
 * برگشتن از بک‌گراند: از هر مدتی خارج از برنامه (حتی چند ثانیه — قبلاً ۱۵
 * دقیقه بود) دوباره روی تنظیمات باز می‌شود.
 */

/** After this long in the background, re-opening the app returns to settings. */
const RETURN_TO_SETTINGS_AFTER_MS = 5 * 1_000;

/** v1.5.4 — only ONE boot redirect per app run (survives theme remounts). */
let bootRedirectDone = false;

export default function TabLayout() {
  const router = useRouter();
  const rootNav = useRootNavigationState();
  const backgroundedAt = useRef<number | null>(null);

  // v1.5.4 — boot belt: after the root navigator is mounted, land on settings
  // exactly once per app run (covers Android activity-state restoration that
  // can override initialRouteName and drop the user on the scanner tab).
  useEffect(() => {
    if (bootRedirectDone || !rootNav?.key) return;
    bootRedirectDone = true;
    try {
      router.replace('/settings');
    } catch {}
  }, [rootNav?.key, router]);

  // v1.4.11 — «باز شدن برنامه = صفحه تنظیمات».
  // v1.4.10 این را با router.replace بعد از اولین mount می‌کرد؛ اما در همان
  // لحظه Root Layout هنوز «ready» نیست (افکت فرزند‌ها قبل از والد اجرا می‌شود)
  // و expo-router این استثنا را می‌انداخت:
  //   «Attempted to navigate before mounting the Root Layout component»
  // → کرش فوری هنگام باز شدن برنامه.
  // حالا شروع روی تنظیمات بدون هیچ navigate برنامه‌ای انجام می‌شود:
  //   • app/+native-intent.tsx مسیر «/» را به «/settings» هدایت می‌کند
  //   • initialRouteName="settings" روی خود تب‌ها (فول‌بک)
  // «برگشتن به تنظیمات بعد از بک‌گراند» (v1.5.4: از ۵ ثانیه به بعد = همیشه)
  // با router.replace انجام می‌شود — آن موقع برنامه کاملاً mount و stable است.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        backgroundedAt.current = Date.now();
      } else if (state === 'active' && backgroundedAt.current !== null) {
        const awayMs = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (awayMs >= RETURN_TO_SETTINGS_AFTER_MS) {
          // Opening the app again → back to settings.
          // v1.4.11 — مسیر بدون گروه؛ مسیر گروه‌دار کرش استارتاپ ۱.۴.۱۰ بود.
          router.replace('/settings');
        }
      }
    });
    return () => sub.remove();
  }, [router]);

  return (
    <Tabs
      initialRouteName="settings"
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.dark.surface,
          borderTopColor: colors.dark.border,
          borderTopWidth: 1,
        },
        tabBarActiveTintColor: colors.dark.accent,
        tabBarInactiveTintColor: colors.dark.textMuted,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          marginHorizontal: 1,
        },
        tabBarHideOnKeyboard: true,
      }}
    >
      {/* Under RTL (Persian devices) the FIRST declared tab renders at the
          far RIGHT — so this declaration order produces, right → left:

          تنظیمات ← مدیریت دارایی ← ترید با AI ← اندیکاتورها ← ردیابی نهنگ‌ها
          ← قبل از پامپ ← شورت میم‌کوین‌ها ← اسکنر دامپ و پامپ                */}
      <Tabs.Screen
        name="settings"
        options={{
          title: 'تنظیمات',
          tabBarIcon: ({ color, size }) => <Settings size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: 'مدیریت دارایی',
          tabBarIcon: ({ color, size }) => <Wallet size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="trade-ai"
        options={{
          title: 'ترید با AI',
          tabBarIcon: ({ color, size }) => <Brain size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="indicators"
        options={{
          title: 'اندیکاتورها',
          tabBarIcon: ({ color, size }) => <TrendingUp size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="whales"
        options={{
          title: 'ردیابی نهنگ‌ها',
          tabBarIcon: ({ color, size }) => <Fish size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="pre-listing"
        options={{
          title: 'قبل از پامپ',
          tabBarIcon: ({ color, size }) => <Rocket size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="meme-scanner"
        options={{
          title: 'شورت میم‌کوین',
          tabBarIcon: ({ color, size }) => <Skull size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="(home)"
        options={{
          title: 'اسکنر دامپ‌وپامپ',
          tabBarIcon: ({ color, size }) => <Radar size={size} color={color} />,
        }}
      />
    </Tabs>
  );
}

import { Tabs, useRouter, useRootNavigationState, useSegments } from 'expo-router';
import { Radar, Settings, Fish, Wallet, Brain, Skull, Rocket, TrendingUp } from 'lucide-react-native';
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import colors from '@/constants/colors';
import {
  LAST_TAB_KEY,
  KNOWN_TABS,
  getCachedLastTab,
  setLastTab,
  tabToHref,
  warmLastTabCache,
  type KnownTab,
} from '@/utils/lastTab';

/**
 * v1.5.12 — «وقتی برنامه را باز میکنم از روی تب اسکن نپره رو تب تنظیمات …
 * گوشی اسکرین میره دوباره گوشی باز میکنم روی اخرین تب بمونه نره روی تنظیمات باز»
 *
 * رفتار جدید (برعکسِ v1.4.11/v1.5.4/v1.5.7):
 *   • هر تعویض تب، در کش ماژول + AsyncStorage ذخیره می‌شود (setLastTab).
 *   • هنگام باز شدن برنامه (شروع سرد، بسته‌شدن توسط سیستم، یا خاموش/روشن شدن
 *     صفحه) یک‌بار تبِ ذخیره‌شده‌ی آخر بازیابی می‌شود — دیگر همیشه «تنظیمات»
 *     باز نمی‌شود؛ کاربر روی همان تبی است که آخرین بار بوده.
 *   • فول‌بک: بار اول نصب (هیچ تبی ذخیره نشده) روی «تنظیمات» می‌ماند
 *     (initialRouteName) — همان رفتار قبلی.
 *
 * حذف‌شده‌های نسخه‌های قبل:
 *   • forced replace به تنظیمات بعد از ۱.۲ ثانیه (v1.5.7)
 *   • بازگشت اجباری به تنظیمات بعد از ۵ ثانیه بک‌گراند (v1.5.4)
 *   • AppState listener مربوط به آن
 */

// کش را در همان لحظه‌ی لود ماژول گرم می‌کنیم تا زودتر از mount ناوبری آماده شود.
warmLastTabCache();

/** بازیابیِ تبِ آخر فقط یک‌بار در هر اجرای برنامه (بقا با تعویض تم/ری‌مانت). */
let bootRestoreDone = false;

export default function TabLayout() {
  const router = useRouter();
  const rootNav = useRootNavigationState();
  // v1.5.12 — cast: overload تایپ‌شده‌ی useSegments تاپل تک‌عضوی برمی‌گرداند.
  const segments = useSegments() as readonly string[];

  // v1.5.12 — هر تعویض تب ذخیره می‌شود (کش هم‌زمان + دیسک، fire-and-forget).
  useEffect(() => {
    if (segments[0] === '(tabs)' && typeof segments[1] === 'string') {
      void setLastTab(segments[1]);
    }
  }, [segments]);

  // v1.5.12 — بازیابی آخرین تب: یک‌بار، بعد از آماده شدن ناوبری ریشه.
  // (قبلاً اینجا router.replace('/settings') بود — حالا به تب ذخیره‌شده می‌رود.)
  useEffect(() => {
    if (bootRestoreDone || !rootNav?.key) return;
    bootRestoreDone = true;
    (async () => {
      try {
        let tab = getCachedLastTab();
        if (!tab) {
          const saved = await AsyncStorage.getItem(LAST_TAB_KEY);
          if (saved && (KNOWN_TABS as readonly string[]).includes(saved)) {
            tab = saved as KnownTab;
          }
        }
        // اگر تبِ ذخیره‌شده «تنظیمات» است، هیچ کاری لازم نیست (همان جا هستیم).
        if (tab && tab !== 'settings') {
          router.replace(tabToHref(tab) as Parameters<typeof router.replace>[0]);
        }
      } catch {
        // هر خطا = ماندن روی تب پیش‌فرض (تنظیمات).
      }
    })();
  }, [rootNav?.key, router]);

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

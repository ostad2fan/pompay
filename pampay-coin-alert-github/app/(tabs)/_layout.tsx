import { Tabs, useRouter, usePathname } from 'expo-router';
import { Radar, Settings, Fish, Wallet, Brain, Skull, Rocket, TrendingUp } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import colors from '@/constants/colors';

/** After this long in the background, re-opening the app returns to settings. */
const RETURN_TO_SETTINGS_AFTER_MS = 15 * 60_000;

export default function TabLayout() {
  const router = useRouter();
  const pathname = usePathname();
  const bootedOnce = useRef(false);
  const backgroundedAt = useRef<number | null>(null);

  useEffect(() => {
    // v1.4.10 — «وقتی برنامه را باز می‌کنم بخش تنظیمات همیشه نشان داده شود»:
    // every fresh app launch lands on the settings tab (where the IP-status
    // card also lives), instead of the last-opened / scanner screen.
    if (!bootedOnce.current) {
      bootedOnce.current = true;
      if (!/settings/.test(pathname ?? '')) {
        router.replace('/(tabs)/settings');
      }
    }
  }, [pathname, router]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') {
        backgroundedAt.current = Date.now();
      } else if (state === 'active' && backgroundedAt.current !== null) {
        const awayMs = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (awayMs >= RETURN_TO_SETTINGS_AFTER_MS) {
          // Opening the app again after a long absence → back to settings.
          router.replace('/(tabs)/settings');
        }
      }
    });
    return () => sub.remove();
  }, [router]);

  return (
    <Tabs
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

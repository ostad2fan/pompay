import { Tabs } from 'expo-router';
import { Radar, Settings, Fish, Wallet, Brain, Skull, Rocket, TrendingUp } from 'lucide-react-native';
import colors from '@/constants/colors';

export default function TabLayout() {
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

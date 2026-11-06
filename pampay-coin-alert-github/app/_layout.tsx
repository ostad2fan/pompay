/**
 * app/_layout.tsx — v1.5.7
 *
 * RE-RESTORED ROOT LAYOUT (v1.5.5/1.5.6 regression fix): the restructured tree
 * accidentally replaced this ROOT with the bare Tabs layout — which removed
 * QueryClientProvider / AppProvider / GestureHandlerRootView / VpnGateProvider
 * / splash handling / StartupIpGate / UpdateBanner / startGlobalAutoEngine.
 * Without those providers every useApp()/useQuery() call crashes on launch.
 *
 * v1.5.7 root structure:
 *   QueryClientProvider → GestureHandlerRootView → AppProvider → VpnGateProvider
 *     → ThemedAppRoot (theme-remount + UpdateBanner + Stack→(tabs) + StartupIpGate
 *       + ThemedAlertHost — همه‌ی پیغام‌های برنامه با تم خودش).
 * Tabs + «صفحه اول = تنظیمات» belts live in app/(tabs)/_layout.tsx.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { AppProvider, useApp } from "@/contexts/AppContext";
import { VpnGateProvider } from "@/contexts/VpnGateContext";
import colors from "@/constants/colors";
import UpdateBanner from "@/components/UpdateBanner";
import StartupIpGate from "@/components/StartupIpGate";
import { ThemedAlertHost } from "@/components/ThemedAlert";
import { startGlobalAutoEngine } from "@/utils/autoTradingEngine";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerBackTitle: "بازگشت" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
    </Stack>
  );
}

/**
 * Remounts the whole navigation tree when the theme changes (key prop) so
 * every themed StyleSheet + inline color re-renders with the new palette.
 */
function ThemedAppRoot() {
  const { settings } = useApp();
  const themeMode = settings.themeMode ?? "dark";
  const isLight = themeMode === "light";

  return (
    <View
      key={themeMode}
      style={{ flex: 1, backgroundColor: colors.dark.background }}
    >
      <StatusBar style={isLight ? "dark" : "light"} />
      {/* New-version banner slides over everything, top of the screen */}
      <UpdateBanner />
      <RootLayoutNav />
      {/* v1.4.7 — full-screen Iran-IP gate: runs on every app open / resume.
          Covers EVERYTHING (highest z-index) until the exit IP is non-Iran. */}
      <StartupIpGate />
      {/* v1.5.7 — همه‌ی پیغام‌های برنامه: مودال درون برنامه با تم خودش */}
      <ThemedAlertHost />
    </View>
  );
}

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
    // v1.5.0/v1.5.7 — معامله‌گر خودکار: موتور GLOBAL — روشن بودن ربات ذخیره می‌شود
    // («با بستن برنامه خاموش نشه»)، هر ۶۰ ثانیه در کل برنامه چرخه می‌زند و با
    // باز شدن دوباره برنامه فوراً اجرا می‌شود. حالت سرور ۲۴/۷ (اعلام تلگرام
    // با برنامه بسته) خودکار فعال می‌شود وقتی ربات روشن + سرور + تلگرام
    // تنظیم باشند — pushAutoTradeConfigToServer داخل persist انجام می‌شود.
    startGlobalAutoEngine();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView>
        <AppProvider>
          {/* v1.4.8 — one shared exit-IP poller (15s + on resume) feeding the
              startup/mid-session gate, the settings IP card and every query
              cut-off while the exit IP is Iranian. */}
          <VpnGateProvider>
            <ThemedAppRoot />
          </VpnGateProvider>
        </AppProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}

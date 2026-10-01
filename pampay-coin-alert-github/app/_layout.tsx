import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { AppProvider, useApp } from "@/contexts/AppContext";
import colors from "@/constants/colors";
import UpdateBanner from "@/components/UpdateBanner";
import StartupIpGate from "@/components/StartupIpGate";

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
    </View>
  );
}

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView>
        <AppProvider>
          <ThemedAppRoot />
        </AppProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}

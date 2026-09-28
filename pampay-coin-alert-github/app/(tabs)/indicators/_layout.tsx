import { Stack } from 'expo-router';
import colors from '@/constants/colors';

// A Stack layout here makes expo-router collapse `indicators/index` into the
// route name "indicators", so the <Tabs.Screen name="indicators"> config in
// (tabs)/_layout.tsx (position, title, icon) actually attaches.
export default function IndicatorsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.dark.background },
        headerTintColor: colors.dark.text,
        headerTitleStyle: { fontWeight: '700' },
        contentStyle: { backgroundColor: colors.dark.background },
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          title: 'اندیکاتورها',
          headerTitleAlign: 'center',
        }}
      />
    </Stack>
  );
}

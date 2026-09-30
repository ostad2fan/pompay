import { Stack } from 'expo-router';
import colors from '@/constants/colors';

export default function WhalesLayout() {
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
          title: 'ردیابی نهنگ‌ها',
          headerTitleAlign: 'center',
        }}
      />
      <Stack.Screen
        name="wallet-detail"
        options={{
          title: 'جزئیات کیف پول',
          headerTitleAlign: 'center',
        }}
      />
      <Stack.Screen
        name="token-detail"
        options={{
          title: 'جزئیات توکن',
          headerTitleAlign: 'center',
          presentation: 'modal',
        }}
      />
    </Stack>
  );
}

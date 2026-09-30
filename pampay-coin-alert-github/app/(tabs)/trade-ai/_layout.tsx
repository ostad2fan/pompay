import { Stack } from 'expo-router';
import colors from '@/constants/colors';

export default function TradeAiLayout() {
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
          title: 'ترید با AI (دمو)',
          headerTitleAlign: 'center',
        }}
      />
      <Stack.Screen
        name="real-trade"
        options={{
          title: 'ترید واقعی',
          headerTitleAlign: 'center',
        }}
      />
    </Stack>
  );
}

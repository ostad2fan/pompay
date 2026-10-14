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
          title: 'ترید با AI — تحلیل هوش مصنوعی',
          headerTitleAlign: 'center',
        }}
      />
      <Stack.Screen
        name="real-trade"
        options={{
          title: 'ترید با AI — ترید واقعی',
          headerTitleAlign: 'center',
        }}
      />
      <Stack.Screen
        name="auto-trade"
        options={{
          title: 'ترید با AI — معامله خودکار',
          headerTitleAlign: 'center',
        }}
      />
    </Stack>
  );
}

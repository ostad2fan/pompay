import { Link, Stack } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { createThemedStyles } from '@/utils/themeStyles';
import colors from "@/constants/colors";

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "صفحه پیدا نشد" }} />
      <View style={styles.container}>
        <Text style={styles.title}>این صفحه وجود ندارد</Text>
        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>بازگشت به صفحه اصلی</Text>
        </Link>
      </View>
    </>
  );
}

const styles = createThemedStyles(() => StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    backgroundColor: colors.dark.background,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    color: colors.dark.text,
  },
  link: {
    marginTop: 15,
    paddingVertical: 15,
  },
  linkText: {
    fontSize: 14,
    color: colors.dark.accent,
  },
}));

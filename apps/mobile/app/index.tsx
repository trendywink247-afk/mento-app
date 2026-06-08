import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

export default function Landing() {
  const router = useRouter();
  const { colors, elevation } = useTheme();

  return (
    <Screen
      footer={
        <PrimaryButton
          label="Start a Conversation"
          onPress={() => router.push('/onboarding/age')}
          accessibilityHint="Begins anonymous onboarding"
          testID="start"
        />
      }
    >
      <View style={styles.hero}>
        <View
          style={[styles.emblem, { backgroundColor: colors.brandTint }, elevation.sm]}
          accessible
          accessibilityRole="image"
          accessibilityLabel="Mento — two people talking"
        >
          <Ionicons name="chatbubbles" size={44} color={colors.accent} />
        </View>

        <Text style={[styles.wordmark, { color: colors.accent }]}>mento</Text>

        <Text
          style={[type.display, styles.headline, { color: colors.ink }]}
          accessibilityRole="header"
        >
          A place to talk with a peer who <Text style={{ color: colors.accent }}>understands</Text>.
        </Text>

        <Text style={[type.body, { color: colors.inkMuted }]}>
          Anonymous. Judgment-free. Real conversations. When you need it most.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, justifyContent: 'center', gap: space.md },
  emblem: {
    width: 88,
    height: 88,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  wordmark: { ...type.display, fontSize: 30, letterSpacing: 0.5 },
  headline: { fontSize: 30, lineHeight: 38 },
});

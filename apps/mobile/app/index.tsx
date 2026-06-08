import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { colors, space, type } from '@/theme/tokens';

export default function Landing() {
  const router = useRouter();
  return (
    <Screen
      footer={
        <PrimaryButton label="Start a Conversation" onPress={() => router.push('/onboarding/age')} />
      }
    >
      <View style={styles.hero}>
        <Text style={styles.wordmark}>mento</Text>
        <Text style={styles.headline}>A place to talk with a peer who understands.</Text>
        <Text style={styles.sub}>
          Anonymous. Judgment-free. Real conversations. When you need it most.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, justifyContent: 'center', gap: space.md },
  wordmark: { ...type.display, color: colors.brand, fontSize: 34 },
  headline: { ...type.title, color: colors.ink, fontSize: 28, lineHeight: 36 },
  sub: { ...type.body, color: colors.inkMuted },
});

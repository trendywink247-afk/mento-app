import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { ChatBubblesScene } from '@/components/art/Scenes';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

/**
 * My Chats — returning-user landing. Phase 5 replaces the empty state with the
 * conversation list (#54/55: search, status chips, unread badges); until then the
 * CTA routes through onboarding's match flow to start a fresh conversation.
 */
export default function ChatsTab() {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <Screen>
      <Text style={[type.displaySerif, { color: colors.ink }]} accessibilityRole="header">
        My Chats
      </Text>

      <View style={styles.empty}>
        <ChatBubblesScene size={150} />
        <Text style={[type.titleSerif, styles.center, { color: colors.ink }]}>
          No conversations yet
        </Text>
        <Text style={[type.body, styles.center, { color: colors.inkMuted }]}>
          When you start talking with a mentor, your conversations will live here — anonymous,
          always.
        </Text>
        <View style={styles.cta}>
          <PrimaryButton
            label="Start a Conversation"
            icon="chatbubble-ellipses"
            trailing="chevron"
            onPress={() => router.push('/onboarding/age')}
            testID="start-from-chats"
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  center: { textAlign: 'center' },
  cta: { alignSelf: 'stretch', marginTop: space.sm },
});

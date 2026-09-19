/**
 * FeedbackPill — the quiet "Feedback" key in a tab screen's header (board A06 / A07).
 *
 * reason: the feedback sheet (board A11) belongs to another lane and this branch has no
 * `/feedback` route yet, so the pill is drawn and leads nowhere until that route lands —
 * then FEEDBACK_ROUTE becomes '/feedback' and nothing else changes. One component for every
 * tab header that carries the pill (My Chats, Path).
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter, type Href } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius } from '@/theme/tokens';

const FEEDBACK_ROUTE: Href | null = null;

export function FeedbackPill({ testID }: { testID: string }) {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <PressKey
      onPress={() => {
        if (FEEDBACK_ROUTE) router.push(FEEDBACK_ROUTE);
      }}
      edge={colors.edgeSurface}
      travel={3}
      radius={radius.pill}
      accessibilityLabel={t('chatsList.feedbackA11y')}
      testID={testID}
      style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Ionicons name="chatbox-outline" size={16} color={colors.inkMuted} />
      <Text style={[styles.text, { color: colors.inkMuted }]}>{t('chatsList.feedback')}</Text>
    </PressKey>
  );
}

const styles = StyleSheet.create({
  pill: { height: 44, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1 },
  text: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
});

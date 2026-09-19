/**
 * FeedbackPill — the quiet "Feedback" key in a tab screen's header (board A06 / A07).
 * Opens the feedback sheet (board A11, `app/feedback.tsx`) and tells it which screen the
 * note is about (`from`), so the team knows where it came from. One component for every
 * header that carries the pill.
 */
import { Ionicons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { StyleSheet, Text } from 'react-native';

import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius } from '@/theme/tokens';

/** `screen`: the ROUTE TEMPLATE to report (`request-sent/[id]`) when the path carries a real
 * id — the feedback API refuses ids and the sheet promises nothing else is attached. */
export function FeedbackPill({ testID, screen }: { testID: string; screen?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <PressKey
      onPress={() => router.push({ pathname: '/feedback', params: { from: screen ?? pathname } })}
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

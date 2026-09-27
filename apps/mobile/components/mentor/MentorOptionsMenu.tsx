import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EndConfirmSheet } from '@/components/mentor/EndConfirmSheet';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS } from '@/theme/companion';
import { radius, space, type, wash } from '@/theme/tokens';

/** The mentor chat's options (board A35): a small card under the options key over a
 * light scrim — Report, End conversation (danger ink), and the line that ending tells
 * the member kindly. End asks once more before it happens. */
export function MentorOptionsMenu({
  state,
  top,
  ending,
  onReport,
  onAskEnd,
  onConfirmEnd,
  onClose,
}: {
  state: 'open' | 'confirmEnd';
  top: number;
  ending: boolean;
  onReport: () => void;
  onAskEnd: () => void;
  onConfirmEnd: () => void;
  onClose: () => void;
}) {
  const { colors, elevation } = useTheme();
  const { t } = useI18n();
  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]}>
      <Pressable
        style={[StyleSheet.absoluteFill, styles.scrim, { backgroundColor: colors.ink }]}
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel={t('mentorChatPage.closeOptions')}
      />
      <View
        style={[styles.card, elevation.md, { top, backgroundColor: colors.surface, borderColor: colors.border }]}
        accessibilityRole="menu"
        testID="mentor-chat-menu-sheet"
      >
        {state === 'open' ? (
          <>
            <PressKey
              onPress={onReport}
              edge="transparent"
              travel={2}
              radius={radius.md}
              accessibilityRole="menuitem"
              testID="mentor-menu-report"
              style={styles.item}
            >
              <View style={[styles.badge, { backgroundColor: wash.orange }]}>
                <Ionicons name="flag-outline" size={18} color={COMPANION_COLORS.mustard.accentEdge} />
              </View>
              <Text style={[type.cardTitle, { color: colors.ink }]}>{t('mentorChatPage.report')}</Text>
            </PressKey>
            <PressKey
              onPress={onAskEnd}
              edge="transparent"
              travel={2}
              radius={radius.md}
              accessibilityRole="menuitem"
              testID="mentor-menu-end"
              style={styles.item}
            >
              <View style={[styles.badge, { backgroundColor: wash.danger }]}>
                <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
              </View>
              <Text style={[type.cardTitle, { color: colors.danger }]}>{t('mentorChatPage.end')}</Text>
            </PressKey>
            <Text style={[type.caption, styles.note, { color: colors.inkMuted }]}>{t('mentorChatPage.endNote')}</Text>
          </>
        ) : (
          <View style={styles.confirm}>
            <EndConfirmSheet busy={ending} onConfirm={onConfirmEnd} onCancel={onClose} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 5 },
  scrim: { opacity: 0.12 },
  card: {
    position: 'absolute',
    right: 12,
    width: 248,
    padding: space.sm,
    gap: space.xs,
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  item: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    backgroundColor: 'transparent',
  },
  badge: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  note: { paddingHorizontal: 12, paddingTop: space.xs, paddingBottom: space.sm },
  confirm: { padding: space.xs },
});

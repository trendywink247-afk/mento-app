/**
 * AllowanceNote — the pause (board A22): "That's three in a row. Give Steady Cedar a
 * moment to reply.", the count, the promise that nothing urgent is ever held, a quiet
 * Helplines toggle and one kind key into the Journal. Shown when the member has sent three
 * in a row or has reached the day's ten.
 *
 * The promise is never folded away (T&S #1): a person who has just been paused has to be
 * able to read, without tapping anything, that a message that matters still goes through.
 * The two numbers sit one tap behind it, so the pause never competes with the crisis card.
 *
 * STILL (T&S #11): nothing here animates — no entrance, no breathing pip, no haptic on
 * arrival — and nothing is red. The field below stays live; only the send key rests.
 * The companion waits on the note's top-left edge (it is this screen's one perch while
 * the note shows).
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { CompanionSlot } from '@/components/art/PerchedCompanion';
import { AllowanceMeter } from '@/components/chat/AllowanceMeter';
import { PressKey } from '@/components/motion/PressKey';
import type { Allowance } from '@/lib/api';
import { HELPLINES } from '@/lib/helplines';
import { useI18n } from '@/lib/i18n';
import type { AllowanceNoteReason } from '@/lib/useAllowance';
import { COMPANION_COLORS } from '@/theme/companion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, type } from '@/theme/tokens';

type Props = {
  allowance: Allowance;
  reason: AllowanceNoteReason;
  /** The mentor's persona name, as the header shows it. */
  name: string;
  onJournal: () => void;
};

/** The companion's seat on the note's top edge (the thread keeps room for it —
 * components/chat/companionRoom.ts). */
export const NOTE_SEAT = { size: 64, nudge: 8 } as const;

export function AllowanceNote({ allowance, reason, name, onJournal }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [helpOpen, setHelpOpen] = useState(false);
  const counts = { left: allowance.left_today, limit: allowance.daily_limit, row: allowance.in_a_row_limit };
  const title =
    reason === 'daily'
      ? t('allowance.dailyTitle', counts)
      : allowance.in_a_row_limit === 3
        ? t('allowance.rowTitle')
        : t('allowance.rowTitleN', counts);
  const body = reason === 'daily' ? t('allowance.dailyBody', { name }) : t('allowance.rowBody', { name });

  return (
    <View style={styles.wrap}>
      <View>
        <CompanionSlot id="composerTop" size={NOTE_SEAT.size} align="left" inset={6} nudge={NOTE_SEAT.nudge} />
        <EdgeSurface
          edge={colors.edgeAlt}
          travel={3}
          radius={radius.lg}
          style={[styles.note, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
          testID="allowance-note"
        >
          <View style={styles.lead}>
            <View style={[styles.badge, { backgroundColor: COMPANION_COLORS.sky.accentTint }]}>
              <Ionicons name="hourglass-outline" size={20} color={COMPANION_COLORS.sky.accentEdge} />
            </View>
            <Text style={[styles.leadText, { color: colors.inkMuted }]} testID="allowance-note-text">
              <Text style={{ fontFamily: font.sansBold, color: colors.ink }}>{title}</Text> {body}
            </Text>
          </View>

          <View style={styles.countRow}>
            <AllowanceMeter
              left={allowance.left_today}
              limit={allowance.daily_limit}
              onNote
              accessibilityLabel={t('allowance.meterA11y', counts)}
            />
            <Text style={[type.caption, styles.count, { color: colors.inkMuted }]} testID="allowance-note-count">
              {t('allowance.leftShort', counts)}
            </Text>
          </View>

          <View style={styles.promiseRow}>
            <Text style={[type.caption, styles.promise, { color: colors.inkMuted }]} testID="allowance-urgent">
              {t('allowance.urgent')}
            </Text>
            <Pressable
              onPress={() => setHelpOpen((open) => !open)}
              accessibilityRole="button"
              accessibilityState={{ expanded: helpOpen }}
              testID="allowance-helplines-toggle"
              style={styles.helpToggle}
            >
              <Ionicons name="call-outline" size={16} color={colors.inkMuted} />
              <Text style={[type.label, styles.underlined, { color: colors.inkMuted }]}>
                {t('allowance.helplines')}
              </Text>
            </Pressable>
          </View>

          {helpOpen ? (
            <View style={styles.help} testID="allowance-helplines">
              <View style={styles.helpKeys}>
                {HELPLINES.map((h, i) => (
                  <PressKey
                    key={h.key}
                    onPress={() => void Linking.openURL(`tel:${h.tel}`)}
                    edge={colors.edgeSurface}
                    travel={3}
                    radius={radius.pill}
                    haptic="none"
                    accessibilityRole="link"
                    accessibilityLabel={t('allowance.callA11y', { name: h.name, number: h.display })}
                    testID={`allowance-call-${h.tel}`}
                    style={[styles.helpKey, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    containerStyle={i === 0 ? styles.helpKeyNarrow : styles.helpKeyWide}
                  >
                    <Text style={[type.caption, styles.helpKeyText, { color: colors.ink }]} numberOfLines={1}>
                      {h.name} {h.display}
                    </Text>
                  </PressKey>
                ))}
              </View>
            </View>
          ) : null}
        </EdgeSurface>
      </View>

      <PressKey
        onPress={onJournal}
        edge={colors.accentTintEdge}
        radius={radius.md}
        intent="navigate"
        testID="allowance-journal"
        style={[styles.journalKey, { backgroundColor: colors.accentTint }]}
      >
        <Ionicons name="book-outline" size={18} color={colors.accent} />
        <Text style={[type.rowTitle, { color: colors.accent }]}>{t('allowance.journalKey')}</Text>
      </PressKey>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10, paddingBottom: 2 },
  note: { paddingTop: 12, paddingHorizontal: 14, paddingBottom: 4, gap: 2, borderWidth: 1 },
  lead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  badge: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  leadText: { flex: 1, fontFamily: font.sans, fontSize: 15, lineHeight: 22 },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 6 },
  count: { flex: 1 },
  promiseRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  promise: { flex: 1 },
  helpToggle: { height: 44, paddingHorizontal: 2, flexDirection: 'row', alignItems: 'center', gap: 6 },
  underlined: { textDecorationLine: 'underline' },
  help: { gap: 8, paddingBottom: 10 },
  helpKeys: { flexDirection: 'row', gap: 8 },
  helpKeyNarrow: { flex: 1 },
  helpKeyWide: { flex: 1.25 },
  helpKey: { height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, paddingHorizontal: 4 },
  helpKeyText: { fontFamily: font.sansBold },
  journalKey: {
    height: 48,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
});

import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { ConsolePressable } from '@/components/console/ConsolePressable';
import { adminApi, type AdminAllowance, type AdminAllowanceDay } from '@/lib/adminApi';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, wash, washInk } from '@/theme/tokens';

/** The window the panel reads once; Today / 7 days / 30 days are tails of it. */
const WINDOW = 30;
/** The per-day table under the board's layout: the last two weeks. */
const TABLE_DAYS = 14;
const PERIODS = [
  { key: 1, label: 'Today' },
  { key: 7, label: '7 days' },
  { key: 30, label: '30 days' },
] as const;
type Period = (typeof PERIODS)[number]['key'];

type Sum = Omit<AdminAllowanceDay, 'day'>;
const ZERO: Sum = {
  messages_sent: 0,
  crisis_exempt_sends: 0,
  in_a_row_pauses: 0,
  members_paused_in_a_row: 0,
  daily_cap_holds: 0,
  members_reached_daily_cap: 0,
};

function sumTail(days: AdminAllowanceDay[], n: number): Sum {
  return days.slice(-n).reduce<Sum>(
    (acc, d) => ({
      messages_sent: acc.messages_sent + d.messages_sent,
      crisis_exempt_sends: acc.crisis_exempt_sends + d.crisis_exempt_sends,
      in_a_row_pauses: acc.in_a_row_pauses + d.in_a_row_pauses,
      members_paused_in_a_row: acc.members_paused_in_a_row + d.members_paused_in_a_row,
      daily_cap_holds: acc.daily_cap_holds + d.daily_cap_holds,
      members_reached_daily_cap: acc.members_reached_daily_cap + d.members_reached_daily_cap,
    }),
    ZERO,
  );
}

/** "2026-09-19" → "19 Sep" (the day is already an IST calendar day; no zone maths). */
function dayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, d)),
  );
}

/**
 * Message allowance counts (board A13, DECISIONS §L.2) — numbers only, never text, names or
 * who. `GET /admin/allowance` writes an `allowance.viewed` audit row per read. The board's
 * two columns (Counts · the rule in force + "Numbers only"), then the last 14 IST days one
 * row each. Crisis-exempt sends lead to Safety review, where access is audited.
 */
export default function AllowancePanel({ onGoto }: { onGoto: (tab: string) => void }) {
  const { colors } = useTheme();
  const accent = colors.accent;
  const [data, setData] = useState<AdminAllowance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>(1);

  const load = useCallback(async () => {
    try {
      setData(await adminApi.allowance(WINDOW));
      setError(null);
    } catch {
      setError('Could not load the allowance counts. Retry shortly.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <View style={styles.body} testID="admin-panel-allowance">
        <Text style={[type.caption, { color: colors.danger }]}>{error}</Text>
      </View>
    );
  }
  if (!data) {
    return (
      <View style={styles.center} testID="admin-panel-allowance">
        <ActivityIndicator size="large" color={accent} />
        <Text style={[type.body, { color: colors.inkMuted }]}>Counting…</Text>
      </View>
    );
  }

  const sum = sumTail(data.days, period);
  const { rule } = data;
  const table = data.days.slice(-TABLE_DAYS).reverse();

  const count = (label: string, value: number, testID: string) => (
    <View style={[styles.countRow, { borderTopColor: colors.border }]} key={testID}>
      <Text style={[type.body, styles.countLabel, { color: colors.ink }]}>{label}</Text>
      <Text style={[styles.countValue, { color: colors.ink }]} testID={testID}>
        {value}
      </Text>
    </View>
  );

  return (
    <View style={styles.body} testID="admin-panel-allowance">
      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={[type.eyebrow, { color: colors.inkMuted }]}>Admin · Allowance</Text>
          <Text style={[type.displayHeadline, styles.h1, { color: colors.ink }]} accessibilityRole="header">
            Message <Text style={{ color: accent }}>allowance</Text>
          </Text>
        </View>
        <View style={styles.periods} accessibilityRole="tablist">
          {PERIODS.map((p) => {
            const on = period === p.key;
            return (
              <ConsolePressable
                key={p.key}
                onPress={() => setPeriod(p.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                testID={`allowance-period-${p.key}`}
                style={[
                  styles.period,
                  on
                    ? { backgroundColor: colors.ink, borderColor: colors.ink }
                    : { backgroundColor: colors.surface, borderColor: colors.border },
                ]}
                hoverStyle={on ? undefined : { backgroundColor: colors.surfaceAlt }}
              >
                <Text style={[type.label, { color: on ? colors.onBrand : colors.ink }]}>{p.label}</Text>
              </ConsolePressable>
            );
          })}
        </View>
      </View>

      <View style={styles.grid}>
        <EdgeSurface
          edge={colors.edgeSurface}
          style={[styles.card, styles.fill, { backgroundColor: colors.surface, borderColor: colors.border }]}
          containerStyle={styles.col}
        >
          <Text style={[type.cardTitle, styles.cardTitle, { color: colors.ink }]}>
            Counts <Text style={[styles.cardAside, { color: colors.inkMuted }]}>· numbers only</Text>
          </Text>
          {count('Member messages sent', sum.messages_sent, 'allowance-messages')}
          {count(`Members who reached ${rule.per_day} for the day`, sum.members_reached_daily_cap, 'allowance-daily-cap')}
          {count(`Times the ${rule.in_a_row}-in-a-row pause showed`, sum.in_a_row_pauses, 'allowance-in-a-row')}
          <ConsolePressable
            onPress={() => onGoto('safety')}
            accessibilityRole="link"
            accessibilityHint="Opens Safety review, where access is audited"
            testID="allowance-crisis-exempt"
            style={[styles.countRow, { borderTopColor: colors.border }]}
            hoverStyle={{ backgroundColor: colors.surfaceAlt }}
          >
            <View style={styles.countLabel}>
              <Text style={[type.cardTitle, { color: colors.dangerInk }]}>Crisis-exempt sends</Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>
                Delivered past the cap because the safety scan flagged them. Never blocked, never counted against the
                member.
              </Text>
            </View>
            <Text style={[styles.countValue, { color: colors.dangerInk }]} testID="allowance-crisis-value">
              {sum.crisis_exempt_sends}
            </Text>
          </ConsolePressable>
        </EdgeSurface>

        <View style={[styles.col, styles.side]}>
          <EdgeSurface
            edge={colors.edgeSurface}
            style={[styles.card, styles.ruleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text style={[type.cardTitle, styles.cardTitle, { color: colors.ink }]}>The rule in force</Text>
            <View style={styles.chips}>
              <Text style={[styles.chip, { backgroundColor: colors.accentTint, color: colors.accentEdge }]}>
                {rule.in_a_row} in a row
              </Text>
              <Text style={[styles.chip, { backgroundColor: colors.accentTint, color: colors.accentEdge }]}>
                {rule.per_day} per day
              </Text>
              <Text style={[styles.chip, { backgroundColor: wash.danger, color: washInk.danger }]}>
                Crisis traffic exempt
              </Text>
              {rule.enforced ? null : (
                // Honest mode line: counting runs, holding is switched off (ALLOWANCE_ENFORCED).
                <Text
                  style={[styles.chip, { backgroundColor: colors.surfaceAlt, color: colors.inkMuted }]}
                  testID="allowance-not-enforced"
                >
                  Counting only, not holding
                </Text>
              )}
            </View>
            <Text style={[type.note, { color: colors.inkMuted }]}>
              Values live in server config, so they change without an app release. Days are IST calendar days;
              member counts add up day by day, so one member on two days counts twice.
            </Text>
          </EdgeSurface>
          <View style={[styles.card, styles.promise, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <View style={[styles.shield, { backgroundColor: wash.indigo }]}>
              <Ionicons name="shield-outline" size={20} color={washInk.indigo} />
            </View>
            <View style={styles.promiseText}>
              <Text style={[type.cardTitle, { color: colors.ink }]}>Numbers only</Text>
              <Text style={[type.note, { color: colors.inkMuted }]}>
                This panel never shows message text, names or who hit the cap. Crisis-exempt sends link to Safety review,
                where access is audited.
              </Text>
            </View>
          </View>
        </View>
      </View>

      <EdgeSurface
        edge={colors.edgeSurface}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        testID="allowance-days"
      >
        <Text style={[type.cardTitle, styles.cardTitle, { color: colors.ink }]}>
          By day <Text style={[styles.cardAside, { color: colors.inkMuted }]}>· last {TABLE_DAYS} days, IST</Text>
        </Text>
        <View style={[styles.tr, { borderTopColor: colors.border }]}>
          {['Day', 'Messages', 'Paused 3 in a row', `Reached ${rule.per_day}`, 'Held by the day cap', 'Crisis-exempt'].map(
            (h, i) => (
              <Text key={h} style={[type.caption, styles.td, i === 0 && styles.tdDay, { color: colors.inkMuted }]}>
                {h}
              </Text>
            ),
          )}
        </View>
        {table.map((d) => (
          <View key={d.day} style={[styles.tr, { borderTopColor: colors.border }]} testID={`allowance-day-${d.day}`}>
            <Text style={[type.note, styles.td, styles.tdDay, { color: colors.ink }]}>{dayLabel(d.day)}</Text>
            <Text style={[type.note, styles.td, styles.num, { color: colors.ink }]}>{d.messages_sent}</Text>
            <Text style={[type.note, styles.td, styles.num, { color: colors.ink }]}>
              {d.members_paused_in_a_row} members · {d.in_a_row_pauses}×
            </Text>
            <Text style={[type.note, styles.td, styles.num, { color: colors.ink }]}>{d.members_reached_daily_cap} members</Text>
            <Text style={[type.note, styles.td, styles.num, { color: colors.ink }]}>{d.daily_cap_holds}</Text>
            <Text style={[type.note, styles.td, styles.num, { color: d.crisis_exempt_sends ? colors.dangerInk : colors.ink }]}>
              {d.crisis_exempt_sends}
            </Text>
          </View>
        ))}
      </EdgeSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 20, paddingVertical: space.md },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 },
  headText: { gap: 2 },
  h1: { lineHeight: 36 },
  periods: { flexDirection: 'row', gap: space.sm },
  period: {
    height: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 20 },
  col: { flexGrow: 1, flexBasis: 360, minWidth: 0 },
  side: { gap: 20 },
  card: { paddingVertical: 20, paddingHorizontal: 24, borderWidth: 1, borderRadius: radius.lg },
  ruleCard: { gap: 10 },
  // The board's two columns stand the same height: the Counts face fills its column.
  fill: { flexGrow: 1 },
  cardTitle: { fontSize: 17, lineHeight: 24, marginBottom: space.sm },
  cardAside: { fontFamily: font.sansSemi, fontSize: 13 },
  countRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  countLabel: { flex: 1, minWidth: 0 },
  countValue: { fontFamily: font.sansHeavy, fontSize: 22, lineHeight: 28, fontVariant: ['tabular-nums'] },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    overflow: 'hidden',
    fontFamily: font.sansBold,
    fontSize: 14,
    lineHeight: 32,
  },
  promise: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  shield: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  promiseText: { flex: 1, gap: 2 },
  tr: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, borderTopWidth: 1 },
  td: { flex: 1, minWidth: 0 },
  tdDay: { flex: 0.7 },
  num: { fontVariant: ['tabular-nums'] },
});

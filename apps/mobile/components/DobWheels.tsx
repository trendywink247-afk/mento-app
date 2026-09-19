/**
 * DobWheels — the date-of-birth tray of the age gate (board A16): a warm tray with a
 * "Date of birth" caption, a live readout of the chosen date, and three pillow wheels
 * (day / month / year). Values are clamped, never wrapped: a hundred years back from this
 * year, twelve months, and only the days that month really has (leap years included) —
 * so an impossible date cannot be built. The value is the same `Dob` the old picker
 * emitted; the server still receives the ISO date and works out the age itself.
 */
import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { type Dob } from '@/components/DobPicker';
import { EdgeSurface } from '@/components/EdgeSurface';
import { Wheel } from '@/components/Wheel';
import { Entrance } from '@/components/motion/Entrance';
import { useI18n, type TKey } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

const MONTHS: TKey[] = [
  'onboarding.dob.month1', 'onboarding.dob.month2', 'onboarding.dob.month3',
  'onboarding.dob.month4', 'onboarding.dob.month5', 'onboarding.dob.month6',
  'onboarding.dob.month7', 'onboarding.dob.month8', 'onboarding.dob.month9',
  'onboarding.dob.month10', 'onboarding.dob.month11', 'onboarding.dob.month12',
];
const MONTHS_SHORT: TKey[] = [
  'onboarding.dob.short1', 'onboarding.dob.short2', 'onboarding.dob.short3',
  'onboarding.dob.short4', 'onboarding.dob.short5', 'onboarding.dob.short6',
  'onboarding.dob.short7', 'onboarding.dob.short8', 'onboarding.dob.short9',
  'onboarding.dob.short10', 'onboarding.dob.short11', 'onboarding.dob.short12',
];

const YEARS_BACK = 100;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const daysIn = (month: number, year: number) => new Date(year, month, 0).getDate(); // month is 1-based
const pad2 = (n: number) => String(n).padStart(2, '0');

export function DobWheels({
  value,
  onChange,
  /** Entrance index of the first wheel — the three arrive one after another. */
  entranceFrom,
  compact,
}: {
  value: Dob;
  onChange: (dob: Dob) => void;
  entranceFrom: number;
  /** Short phones: shallower wheel targets. */
  compact?: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const maxYear = new Date().getFullYear();
  const minYear = maxYear - YEARS_BACK;
  const maxDay = daysIn(value.month, value.year);
  // A held wheel steps from the LATEST value, not the one captured when the hold began.
  const latest = useRef(value);
  latest.current = value;

  const go = (patch: Partial<Dob>) => {
    const next = { ...latest.current, ...patch };
    next.year = clamp(next.year, minYear, maxYear);
    next.month = clamp(next.month, 1, 12);
    next.day = clamp(next.day, 1, daysIn(next.month, next.year));
    const now = latest.current;
    if (next.day === now.day && next.month === now.month && next.year === now.year) return;
    latest.current = next;
    onChange(next);
  };

  const short = (m: number) => t(MONTHS_SHORT[m - 1]);
  const { day, month, year } = value;

  return (
    <EdgeSurface
      edge={colors.edgeAlt}
      travel={3}
      radius={radius.lg}
      style={[styles.tray, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
    >
      <View style={styles.head}>
        <Text style={[styles.caption, { color: colors.inkMuted }]}>{t('onboarding.dob.caption')}</Text>
        <Text
          style={[type.rowTitle, styles.readout, { color: colors.ink }]}
          accessibilityLiveRegion="polite"
          testID="dob-readout"
        >
          {t('onboarding.dob.readout', { day, month: t(MONTHS[month - 1]), year })}
        </Text>
      </View>

      <View style={styles.wheels}>
        <Entrance index={entranceFrom} style={styles.day}>
          <Wheel
            label={t('onboarding.dob.day')}
            value={pad2(day)}
            prev={day > 1 ? pad2(day - 1) : ''}
            next={day < maxDay ? pad2(day + 1) : ''}
            onStep={(dir) => go({ day: latest.current.day + dir })}
            upA11y={t('onboarding.dob.dayUp')}
            downA11y={t('onboarding.dob.dayDown')}
            compact={compact}
            testID="dob-day"
          />
        </Entrance>
        <Entrance index={entranceFrom + 1} style={styles.month}>
          <Wheel
            label={t('onboarding.dob.month')}
            value={short(month)}
            prev={month > 1 ? short(month - 1) : ''}
            next={month < 12 ? short(month + 1) : ''}
            onStep={(dir) => go({ month: latest.current.month + dir })}
            upA11y={t('onboarding.dob.monthUp')}
            downA11y={t('onboarding.dob.monthDown')}
            compact={compact}
            testID="dob-month"
          />
        </Entrance>
        <Entrance index={entranceFrom + 2} style={styles.year}>
          <Wheel
            label={t('onboarding.dob.year')}
            value={String(year)}
            prev={year > minYear ? String(year - 1) : ''}
            next={year < maxYear ? String(year + 1) : ''}
            onStep={(dir) => go({ year: latest.current.year + dir })}
            upA11y={t('onboarding.dob.yearUp')}
            downA11y={t('onboarding.dob.yearDown')}
            compact={compact}
            testID="dob-year"
          />
        </Entrance>
      </View>
    </EdgeSurface>
  );
}

const styles = StyleSheet.create({
  tray: { padding: space.md, gap: 12, borderWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  caption: {
    fontFamily: font.sansBold,
    fontSize: 13,
    lineHeight: 20,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  readout: { flexShrink: 1, textAlign: 'right' },
  wheels: { flexDirection: 'row', gap: 10 },
  // Board proportions: day 1 · month 1.15 · year 1.3.
  day: { flex: 1, minWidth: 0 },
  month: { flex: 1.15, minWidth: 0 },
  year: { flex: 1.3, minWidth: 0 },
});

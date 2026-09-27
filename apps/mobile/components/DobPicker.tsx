import Ionicons from '@expo/vector-icons/Ionicons';
import { Picker } from '@react-native-picker/picker';
import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useI18n, type TKey } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/**
 * One coherent Day / Month / Year date-of-birth picker (DECISIONS §E.15), used on web
 * and native. Styled per mockup #3: a single tinted card, three hairline-divided
 * columns — chevron, big value, label inside. (The mockup's "Years/Months/Year"
 * column labels were semantically wrong; ours stay Day/Month/Year.) The real
 * @react-native-picker/picker sits invisibly over each column, so web keeps an
 * accessible <select> and native keeps the wheel/dialog. Age is computed server-side.
 */

export type Dob = { day: number; month: number; year: number };

const MONTHS: TKey[] = [
  'onboarding.dob.month1', 'onboarding.dob.month2', 'onboarding.dob.month3',
  'onboarding.dob.month4', 'onboarding.dob.month5', 'onboarding.dob.month6',
  'onboarding.dob.month7', 'onboarding.dob.month8', 'onboarding.dob.month9',
  'onboarding.dob.month10', 'onboarding.dob.month11', 'onboarding.dob.month12',
];

function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate(); // month is 1-based here
}

const pad2 = (n: number) => String(n).padStart(2, '0');

function Column({
  label,
  display,
  divider,
  children,
}: {
  label: string;
  display: string;
  divider?: boolean;
  children: ReactNode; // the invisible Picker overlay
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.col, divider && { borderLeftWidth: 1, borderLeftColor: colors.border }]}>
      <Ionicons name="chevron-down" size={16} color={colors.inkMuted} />
      <Text style={[styles.value, { color: colors.ink }]}>{display}</Text>
      <Text style={[type.caption, { color: colors.inkMuted }]}>{label}</Text>
      <View style={styles.overlay}>{children}</View>
    </View>
  );
}

export function DobPicker({
  value,
  onChange,
}: {
  value: Dob;
  onChange: (dob: Dob) => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 100 }, (_, i) => thisYear - i); // newest first
  const maxDay = daysInMonth(value.month, value.year);
  const days = Array.from({ length: maxDay }, (_, i) => i + 1);

  const set = (patch: Partial<Dob>) => {
    const next = { ...value, ...patch };
    // Clamp day to the (possibly shorter) month so we never emit an invalid date.
    const cap = daysInMonth(next.month, next.year);
    if (next.day > cap) next.day = cap;
    onChange(next);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
      <Column label={t('onboarding.dob.day')} display={pad2(value.day)}>
        <Picker
          selectedValue={value.day}
          onValueChange={(v) => set({ day: Number(v) })}
          accessibilityLabel={t('onboarding.dob.dayA11y')}
          style={styles.picker}
        >
          {days.map((d) => (
            <Picker.Item key={d} label={String(d)} value={d} color={colors.ink} />
          ))}
        </Picker>
      </Column>

      <Column label={t('onboarding.dob.month')} display={pad2(value.month)} divider>
        <Picker
          selectedValue={value.month}
          onValueChange={(v) => set({ month: Number(v) })}
          accessibilityLabel={t('onboarding.dob.monthA11y')}
          style={styles.picker}
        >
          {MONTHS.map((m, i) => (
            <Picker.Item key={m} label={t(m)} value={i + 1} color={colors.ink} />
          ))}
        </Picker>
      </Column>

      <Column label={t('onboarding.dob.year')} display={String(value.year)} divider>
        <Picker
          selectedValue={value.year}
          onValueChange={(v) => set({ year: Number(v) })}
          accessibilityLabel={t('onboarding.dob.yearA11y')}
          style={styles.picker}
        >
          {years.map((y) => (
            <Picker.Item key={y} label={String(y)} value={y} color={colors.ink} />
          ))}
        </Picker>
      </Column>
    </View>
  );
}

/** ISO YYYY-MM-DD for the API (which computes age + enforces the gate). */
export function dobToISO(d: Dob): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: space.lg,
  },
  col: { flex: 1, alignItems: 'center', gap: space.sm },
  value: { fontFamily: font.sansBold, fontSize: 28, lineHeight: 34 },
  // The functional Picker covers the column invisibly: taps/keyboard/AT hit the real
  // <select> (web) or wheel/dialog (native) while the styled display shows through.
  overlay: { ...StyleSheet.absoluteFillObject, opacity: 0 },
  picker: { width: '100%', height: '100%' },
});

import { Picker } from '@react-native-picker/picker';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/**
 * One coherent Day / Month / Year date-of-birth picker (DECISIONS §E.15), used on web
 * and native. @react-native-picker/picker renders an accessible <select> on web and the
 * native wheel/dropdown on device. Age is computed server-side from the DOB.
 */

export type Dob = { day: number; month: number; year: number };

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate(); // month is 1-based here
}

export function DobPicker({
  value,
  onChange,
}: {
  value: Dob;
  onChange: (dob: Dob) => void;
}) {
  const { colors } = useTheme();
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

  const col = [styles.col, { borderColor: colors.border, backgroundColor: colors.surface }];
  const itemColor = { color: colors.ink };

  return (
    <View style={styles.row}>
      <View style={styles.field}>
        <Text style={[type.caption, styles.cap]}>Day</Text>
        <View style={col}>
          <Picker
            selectedValue={value.day}
            onValueChange={(v) => set({ day: Number(v) })}
            accessibilityLabel="Day of birth"
            style={[styles.picker, itemColor]}
            dropdownIconColor={colors.inkMuted}
          >
            {days.map((d) => (
              <Picker.Item key={d} label={String(d)} value={d} color={colors.ink} />
            ))}
          </Picker>
        </View>
      </View>

      <View style={[styles.field, styles.fieldWide]}>
        <Text style={[type.caption, styles.cap]}>Month</Text>
        <View style={col}>
          <Picker
            selectedValue={value.month}
            onValueChange={(v) => set({ month: Number(v) })}
            accessibilityLabel="Month of birth"
            style={[styles.picker, itemColor]}
            dropdownIconColor={colors.inkMuted}
          >
            {MONTHS.map((m, i) => (
              <Picker.Item key={m} label={m} value={i + 1} color={colors.ink} />
            ))}
          </Picker>
        </View>
      </View>

      <View style={styles.field}>
        <Text style={[type.caption, styles.cap]}>Year</Text>
        <View style={col}>
          <Picker
            selectedValue={value.year}
            onValueChange={(v) => set({ year: Number(v) })}
            accessibilityLabel="Year of birth"
            style={[styles.picker, itemColor]}
            dropdownIconColor={colors.inkMuted}
          >
            {years.map((y) => (
              <Picker.Item key={y} label={String(y)} value={y} color={colors.ink} />
            ))}
          </Picker>
        </View>
      </View>
    </View>
  );
}

/** ISO YYYY-MM-DD for the API (which computes age + enforces the gate). */
export function dobToISO(d: Dob): string {
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  field: { flex: 1 },
  fieldWide: { flex: 1.4 },
  cap: { marginBottom: space.xs },
  col: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  picker: { height: 54, width: '100%' },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useI18n, type TKey } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { colorsFor, radius, space, type, type Appearance, type Look } from '@/theme/tokens';

const CHOICES: { key: Appearance; title: TKey; sub: TKey }[] = [
  { key: 'pastel', title: 'appearance.pastel', sub: 'appearance.pastelSub' },
  { key: 'light', title: 'appearance.light', sub: 'appearance.lightSub' },
  { key: 'dark', title: 'appearance.dark', sub: 'appearance.darkSub' },
  { key: 'system', title: 'appearance.system', sub: 'appearance.systemSub' },
];

/** A small page drawn in one look: a ground, a message from them and one from you. */
function Preview({ look }: { look: Look }) {
  const c = colorsFor(look);
  const accent = look === 'dark' ? '#7FB0D3' : '#3B6D8F';
  const tint = look === 'dark' ? '#1F3447' : '#DCE8F2';
  return (
    <View style={[styles.preview, { backgroundColor: c.bg }]}>
      <View style={[styles.bar, { backgroundColor: c.border, width: '55%' }]} />
      <View style={[styles.bubble, { backgroundColor: c.surface, borderColor: c.border, width: '78%' }]} />
      <View style={[styles.bubble, { backgroundColor: tint, borderColor: accent, alignSelf: 'flex-end', width: '62%' }]} />
    </View>
  );
}

/** Four looks. System shows the phone's two looks side by side. */
export function AppearancePicker() {
  const { colors, appearance, setAppearance } = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.grid} accessibilityRole="radiogroup">
      {CHOICES.map(({ key, title, sub }) => {
        const selected = appearance === key;
        return (
          <Pressable
            key={key}
            style={styles.cell}
            onPress={() => setAppearance(key)}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={`${t(title)}. ${t(sub)}`}
            testID={`appearance-${key}`}
          >
            <View style={[styles.frame, { borderColor: selected ? colors.accent : colors.border, borderWidth: selected ? 2 : 1 }]}>
              {key === 'system' ? (
                <View style={styles.split}>
                  <View style={styles.half}><Preview look="light" /></View>
                  <View style={styles.half}><Preview look="dark" /></View>
                </View>
              ) : (
                <Preview look={key} />
              )}
              {selected ? (
                <View style={[styles.check, { backgroundColor: colors.accent }]}>
                  <Ionicons name="checkmark" size={14} color={colors.onAccent} />
                </View>
              ) : null}
            </View>
            <Text style={[type.label, { color: colors.ink }]}>{t(title)}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{t(sub)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: { width: '47%', flexGrow: 1, gap: 4 },
  frame: { height: 118, borderRadius: radius.lg, overflow: 'hidden' },
  preview: { flex: 1, padding: 12, gap: 7, justifyContent: 'center' },
  bar: { height: 8, borderRadius: 4 },
  bubble: { height: 20, borderRadius: 10, borderWidth: 1 },
  split: { flex: 1, flexDirection: 'row' },
  half: { flex: 1 },
  check: { position: 'absolute', top: 8, right: 8, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
});

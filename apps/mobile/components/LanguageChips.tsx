import { StyleSheet, Text, View } from 'react-native';

import { PressKey } from '@/components/motion/PressKey';
import { LANGUAGES, toggleLanguage } from '@/lib/languages';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/** Pick up to five languages. Each chip is the language in its own script. */
export function LanguageChips({ value, onChange, testIDPrefix = 'lang' }: { value: string[]; onChange: (next: string[]) => void; testIDPrefix?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap} accessibilityRole="list">
      {LANGUAGES.map(({ code, name }) => {
        const on = value.includes(code);
        return (
          <PressKey
            key={code}
            onPress={() => onChange(toggleLanguage(value, code))}
            edge={on ? colors.accentTintEdge : colors.edgeSurface}
            travel={3}
            radius={radius.pill}
            intent="select"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={name}
            testID={`${testIDPrefix}-${code}`}
            style={[styles.chip, { backgroundColor: on ? colors.accentTint : colors.surface, borderColor: on ? colors.accent : colors.border }]}
          >
            <Text style={[type.label, { color: on ? colors.accentInk : colors.ink }]}>{name}</Text>
          </PressKey>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS } from '@/theme/companion';
import { radius, type } from '@/theme/tokens';

/** The mentor side's page header (board A36 / A37): the round pillow back key, a small
 * sage line over the page's name. No arrival — it is simply there. */
export function MentorPageHeader({
  eyebrow,
  title,
  onBack,
  backLabel,
}: {
  eyebrow: string;
  title: string;
  onBack: () => void;
  backLabel?: string;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.row}>
      <PressKey
        onPress={onBack}
        edge={colors.edgeSurface}
        travel={4}
        radius={radius.pill}
        intent="navigate"
        accessibilityLabel={backLabel ?? t('common.goBack')}
        testID="back"
        style={[styles.key, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Ionicons name="chevron-back" size={22} color={colors.ink} />
      </PressKey>
      <View style={styles.text}>
        <Text style={[type.caption, styles.eyebrow, { color: COMPANION_COLORS.sage.accentEdge }]} numberOfLines={2}>
          {eyebrow}
        </Text>
        <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
          {title}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  key: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  text: { flex: 1, minWidth: 0 },
  eyebrow: { fontFamily: type.label.fontFamily },
  title: { fontSize: 17, lineHeight: 24, fontFamily: type.label.fontFamily },
});

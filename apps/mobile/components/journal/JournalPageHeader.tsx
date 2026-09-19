/**
 * JournalPageHeader — the top of a journal deeper page (board A28 / A29 / A30): the round
 * pillow back key, which is simply there, and a two-line label beside it. Write leads with
 * an accent eyebrow over the date; the other two lead with "Journal" over a quiet line.
 */
import { StyleSheet, Text, View } from 'react-native';

import { BackKey } from '@/components/DeepHeader';
import { useTheme } from '@/theme/ThemeProvider';
import { font, type } from '@/theme/tokens';

export function JournalPageHeader({
  onBack,
  backLabel,
  eyebrow,
  title,
  sub,
}: {
  onBack: () => void;
  backLabel: string;
  /** Accent small caps above a large title (Write). */
  eyebrow?: string;
  title: string;
  sub?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <BackKey onPress={onBack} label={backLabel} />
      <View style={styles.text}>
        {eyebrow ? <Text style={[styles.eyebrow, { color: colors.accent }]}>{eyebrow}</Text> : null}
        <Text
          style={[eyebrow ? styles.bigTitle : styles.title, { color: colors.ink }]}
          accessibilityRole={eyebrow ? 'header' : undefined}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {title}
        </Text>
        {sub ? <Text style={[type.caption, { color: colors.inkMuted }]}>{sub}</Text> : null}
      </View>
    </View>
  );
}

export const eyebrowStyle = {
  fontFamily: font.sansBold,
  fontSize: 12,
  lineHeight: 16,
  letterSpacing: 0.7,
  textTransform: 'uppercase' as const,
};

const styles = StyleSheet.create({
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, minWidth: 0 },
  eyebrow: eyebrowStyle,
  bigTitle: { fontFamily: font.sansHeavy, fontSize: 22, lineHeight: 28 },
  title: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 24 },
});

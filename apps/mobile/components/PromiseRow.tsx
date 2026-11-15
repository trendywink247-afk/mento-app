/**
 * PromiseRow — a wash icon disc, a short bold line and one quiet line under it (board A18
 * "A real person replies", A19 "Not sure how to start?"). Static; it belongs inside a card
 * or an EdgeSurface the caller draws.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { useTheme } from '@/theme/ThemeProvider';
import { type, type Wash } from '@/theme/tokens';

export function PromiseRow({
  icon,
  tone,
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: Wash;
  title: string;
  /** Optional second line; the signup Ready screen shows titles only (DECISIONS R.1). */
  body?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <IconBadge icon={icon} tone={tone} size={40} />
      <View style={styles.text}>
        <Text style={[type.rowTitle, { color: colors.ink }]}>{title}</Text>
        {body ? <Text style={[type.caption, { color: colors.inkMuted }]}>{body}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 40 },
  text: { flex: 1 },
});

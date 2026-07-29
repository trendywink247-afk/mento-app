/** Crisis support card — renders the SERVER-injected crisis payload (helplines +
 * support copy). Shown to the member, and to the listener in the console so they
 * know exactly which resources the member was shown. The client never scans. */
import { Ionicons } from '@expo/vector-icons';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

export type CrisisPayload = {
  support: string;
  signal: string;
  helplines: { name: string; number: string; hours: string }[];
};

export function CrisisCard({
  crisis,
  onDismiss,
}: {
  crisis: CrisisPayload;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={[styles.crisis, { backgroundColor: colors.brandTint }]} testID="crisis-card">
      <Text style={[styles.crisisTitle, { color: colors.ink }]}>{t('crisis.title')}</Text>
      <Text style={[type.body, { color: colors.ink }]}>{crisis.support}</Text>
      <View style={{ gap: space.sm }}>
        {crisis.helplines.map((h) => (
          <Pressable
            key={h.number}
            style={[styles.helpline, { backgroundColor: colors.surface }]}
            onPress={() => void Linking.openURL(`tel:${h.number}`)}
            accessibilityRole="button"
            accessibilityLabel={t('crisis.callA11y', { name: h.name, number: h.number, hours: h.hours })}
          >
            <IconBadge icon="call-outline" size={36} tone="green" />
            <View style={{ flex: 1 }}>
              <Text style={[type.label, { color: colors.ink }]}>{h.name}</Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>{h.number}</Text>
            </View>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{h.hours}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={onDismiss} hitSlop={8} style={styles.crisisDismiss} accessibilityRole="button">
        <Text style={[type.caption, { color: colors.accent }]}>{t('crisis.close')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  crisis: {
    margin: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    gap: space.sm,
  },
  crisisTitle: { fontFamily: font.serifBold, fontSize: 18, lineHeight: 24 },
  helpline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.sm,
  },
  crisisDismiss: { alignSelf: 'flex-end' },
});

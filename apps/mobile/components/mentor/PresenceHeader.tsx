import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Companion } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { PressKey } from '@/components/motion/PressKey';
import { Tilt3D } from '@/components/motion/Tilt3D';
import { useI18n } from '@/lib/i18n';
import type { ListenerMe } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/** Mentor Home's hero once the console is live: the companion greets, presence line
 * reads seat load at a glance, the online/away toggle IS the console's main
 * control (no separate settings screen for it), and "Your line" opens the sheet
 * where the mentor edits the one-sentence public line + availability note members
 * see on the member-side mentor profile (spec §3.3, app/mentor/line.tsx). */
export function PresenceHeader({
  me,
  animal,
  busy,
  swept,
  onToggle,
}: {
  me: ListenerMe;
  animal: CompanionAnimal | null;
  busy: boolean;
  swept: boolean;
  onToggle: () => void;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const online = me.status === 'online';

  return (
    <View style={styles.wrap} testID="mentor-console">
      <Tilt3D maxTilt={6}>
        <Companion animal={animal} size={96} trigger={{ kind: 'greet', n: 1 }} />
      </Tilt3D>
      <Text style={[type.displayHeadline, styles.title, { color: colors.ink }]} accessibilityRole="header">
        {t('mentor.greeting', { name: me.persona_name })}
      </Text>
      <Text
        style={[type.caption, styles.presence, { color: online ? colors.success : colors.inkMuted }]}
        testID="mentor-presence"
      >
        {`● ${online ? t('mentor.online') : t('mentor.away')} · ${t('mentor.seats', {
          used: me.active_conversations,
          max: me.max_concurrent,
        })}`}
      </Text>
      {swept ? (
        <Text style={[type.caption, styles.swept, { color: colors.inkMuted }]} testID="mentor-swept">
          {t('mentor.sweptAway')}
        </Text>
      ) : null}
      <PressKey
        onPress={onToggle}
        edge={online ? colors.edgeSurface : colors.accentEdge}
        travel={3}
        radius={radius.pill}
        disabled={busy}
        accessibilityRole="switch"
        accessibilityState={{ checked: online }}
        testID="mentor-status-toggle"
        containerStyle={styles.toggleContainer}
        style={[
          styles.toggle,
          { backgroundColor: online ? colors.surface : colors.accent },
        ]}
      >
        <Text style={[type.bodySemi, { color: online ? colors.ink : colors.onAccent }]}>
          {online ? t('mentor.goAway') : t('mentor.goOnline')}
        </Text>
      </PressKey>

      <PressKey
        onPress={() => router.push('/mentor/line')}
        edge={colors.edgeSurface}
        travel={2}
        radius={radius.pill}
        testID="your-line"
        containerStyle={styles.lineRowContainer}
        style={[styles.lineRow, { backgroundColor: colors.surface }]}
      >
        <Text
          style={[type.caption, styles.lineText, { color: me.public_line ? colors.ink : colors.inkMuted }]}
          numberOfLines={1}
        >
          {me.public_line || t('mentor.line.placeholder')}
        </Text>
        <Text style={[type.label, { color: colors.accent }]}>{t('mentor.line.row')}</Text>
      </PressKey>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.xs, marginTop: space.lg, marginBottom: space.md },
  title: { textAlign: 'center', marginTop: space.sm },
  presence: { marginTop: space.xs },
  swept: { textAlign: 'center' },
  toggleContainer: { marginTop: space.sm, minHeight: 44 },
  toggle: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lineRowContainer: { marginTop: space.sm, alignSelf: 'stretch', minHeight: 44 },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
  lineText: { flex: 1 },
});

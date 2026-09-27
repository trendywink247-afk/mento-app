import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { EdgeSurface } from '@/components/EdgeSurface';
import { IconBadge } from '@/components/IconBadge';
import { Companion } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { useBreathing } from '@/components/motion/useBreathing';
import { useI18n } from '@/lib/i18n';
import type { ListenerMe } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS } from '@/theme/companion';
import { radius, space, type, wash } from '@/theme/tokens';

/** Hours until the next 04:00 IST rename, rounded up (the server owns the instant). */
function hoursUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return null;
  return Math.max(1, Math.ceil(ms / 3_600_000));
}

/** Mentor Home's head once the console is live (board A10): the greeting with today's
 * name, the rotation hint, the presence card with the companion perched on its top edge
 * (online/away IS the console's main control), "Your line", and Reading 1. */
export function PresenceHeader({
  me,
  animal,
  busy,
  swept,
  onToggle,
  onOpenLine,
}: {
  me: ListenerMe;
  animal: CompanionAnimal | null;
  busy: boolean;
  swept: boolean;
  onToggle: () => void;
  /** Opens the "Your line" sheet over this (settled-back) Mentor Home. */
  onOpenLine: () => void;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const breathing = useBreathing();
  const online = me.status === 'online';
  const face: CompanionAnimal = (me.companion_animal as CompanionAnimal | undefined) ?? animal ?? 'Owl';
  const hours = hoursUntil(me.name_changes_at);
  const sage = COMPANION_COLORS.sage;
  // The name story is told ONCE, under the greeting; the presence card keeps the seats.
  // (Both said it before: "…names change every day at 4 am" and "· your name changes in 2 h".)
  // The rule under the greeting, the countdown in the card — each says its own thing.
  // (Before, both carried the whole sentence: "…names change every day at 4 am" and
  // "· your name changes in 2 h".)
  const rotation = t('mentorHomePage.rotationLine');
  const sub = [
    t('mentor.seats', { used: me.active_conversations, max: me.max_concurrent }),
    hours ? t('mentorHomePage.namesIn', { hours }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View style={styles.wrap} testID="mentor-console">
      <Entrance index={0}>
        <Text style={[styles.h1, styles.clearOfPerch, { color: colors.ink }]} accessibilityRole="header">
          {t('mentorHomePage.greeting')}
          {'\n'}
          <Text style={{ color: colors.accent }}>{me.persona_name}</Text>
        </Text>
        <Text style={[type.caption, styles.hint, styles.clearOfPerch, { color: colors.inkMuted }]} testID="mentor-rotation-hint">
          {rotation}
        </Text>
      </Entrance>

      <View style={styles.perchZone}>
        <View
          style={styles.perch}
          pointerEvents="none"
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('mentorHomePage.companionA11y')}
        >
          <Animated.View style={[styles.originBottom, breathing]}>
            {/* The mentor's OWN face — the same animal members see for them in Browse, My
                Chats and the chat header (server mentor_face). The device's member companion
                is only a fallback for a server that does not send it. */}
            <View testID={`self-mentor-${face}`}>
              <Companion animal={face} size={90} awake />
            </View>
          </Animated.View>
        </View>
        <Entrance index={1}>
          <EdgeSurface
            edge={colors.edgeSurface}
            style={[styles.presence, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <View
              style={[
                styles.dot,
                { backgroundColor: online ? colors.success : colors.inkMuted, borderColor: online ? wash.green : colors.surfaceAlt },
              ]}
            />
            <View style={styles.presenceText}>
              <Text style={[styles.status, { color: colors.ink }]} testID="mentor-presence">
                {online ? t('mentor.online') : t('mentor.away')}
              </Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>{sub}</Text>
            </View>
            <PressKey
              onPress={onToggle}
              edge={online ? colors.edgeAlt : colors.accentEdge}
              travel={4}
              intent="toggle"
              radius={radius.md}
              disabled={busy}
              accessibilityRole="switch"
              accessibilityState={{ checked: online }}
              testID="mentor-status-toggle"
              style={[
                styles.toggle,
                online
                  ? { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1 }
                  : { backgroundColor: colors.accent },
              ]}
            >
              <Text style={[type.label, { color: online ? colors.ink : colors.onAccent }]}>
                {online ? t('mentor.goAway') : t('mentor.goOnline')}
              </Text>
            </PressKey>
          </EdgeSurface>
        </Entrance>
      </View>
      {swept ? (
        <Text style={[type.caption, styles.swept, { color: colors.inkMuted }]} testID="mentor-swept">
          {t('mentor.sweptAway')}
        </Text>
      ) : null}

      <Entrance index={2} style={styles.rows}>
        <PressKey
          onPress={onOpenLine}
          edge={colors.edgeSurface}
          travel={4}
          radius={radius.md}
          accessibilityLabel={t('mentorHomePage.lineA11y')}
          testID="your-line"
          style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <IconBadge icon="pencil-outline" tone="accent" size={36} />
          <View style={styles.rowText}>
            <Text style={[type.caption, styles.bold, { color: colors.inkMuted }]}>{t('mentorHomePage.lineLabel')}</Text>
            <Text
              style={[type.bodySmall, styles.semi, { color: me.public_line ? colors.ink : colors.inkMuted }]}
              // Three lines hold a whole 120-character line at 360 wide.
              numberOfLines={3}
            >
              {/* No line yet: an invitation, never a sample sentence that reads as if it
                  were already theirs. */}
              {me.public_line || t('mentorLineSheet.rowEmpty')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
        </PressKey>

        <PressKey
          onPress={() => router.push('/mentor/reading')}
          edge={colors.edgeSurface}
          travel={4}
          radius={radius.md}
          intent="navigate"
          testID="mentor-reading-row"
          style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <IconBadge icon="book-outline" tone="orange" size={36} />
          <View style={styles.rowText}>
            <Text style={[type.caption, styles.bold, { color: colors.inkMuted }]}>{t('mentorHomePage.readingEyebrow')}</Text>
            <Text style={[type.bodySmall, styles.semi, { color: colors.ink }]}>{t('mentorHomePage.readingTitle')}</Text>
          </View>
          <View style={[styles.pill, { backgroundColor: wash.green }]}>
            <Text style={[styles.pillText, { color: sage.accentEdge }]}>{t('mentorHomePage.readingBadge')}</Text>
          </View>
        </PressKey>
      </Entrance>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  h1: { fontSize: 26, lineHeight: 34, fontFamily: type.displayHeadline.fontFamily, paddingHorizontal: space.sm, paddingTop: space.xs },
  hint: { paddingHorizontal: space.sm, paddingTop: 2 },
  // The companion stands on the card's top edge (board: bottom = 100% - 8), rising into the
  // heading's empty right side — the heading keeps its words clear of it.
  perchZone: { marginTop: -space.xs },
  perch: { position: 'absolute', right: space.md, top: -82, height: 90, zIndex: 2, alignItems: 'center', justifyContent: 'flex-end' },
  clearOfPerch: { paddingRight: 104 },
  originBottom: { transformOrigin: 'bottom' },
  presence: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingLeft: space.md,
    paddingRight: 12,
    borderWidth: 1,
  },
  dot: { width: 24, height: 24, borderRadius: radius.pill, borderWidth: 5, marginLeft: -5 },
  presenceText: { flex: 1, minWidth: 0, paddingLeft: 2 },
  status: { fontSize: 18, lineHeight: 24, fontFamily: type.label.fontFamily },
  toggle: { height: 44, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
  swept: { paddingHorizontal: space.sm },
  rows: { gap: 12 },
  row: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: space.sm,
    paddingLeft: 14,
    paddingRight: 12,
    borderWidth: 1,
  },
  rowText: { flex: 1, minWidth: 0 },
  bold: { fontFamily: type.label.fontFamily },
  semi: { fontFamily: type.bodySemi.fontFamily, lineHeight: 20 },
  pill: { height: 24, paddingHorizontal: 10, borderRadius: radius.pill, justifyContent: 'center' },
  pillText: { fontSize: 12, lineHeight: 16, fontFamily: type.label.fontFamily },
});

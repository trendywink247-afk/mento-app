/**
 * ChatRow — one conversation on My Chats (board A06 "richer rows"): the mentor's avatar
 * (with the new-message dot), today's persona name, the In touch badge, a state chip,
 * the time, "first talked as …", the last line and — for an active chat — what was saved.
 *
 * Presentational: My Chats owns the data and the navigation. It shows only what is true —
 * no badge without an accepted link, no "first talked as" unless the server sent a name,
 * no saved count at zero.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';

import { InTouchBadge } from '@/components/InTouchBadge';
import { MentorAvatar } from '@/components/art/MentorAvatar';
import { PressKey } from '@/components/motion/PressKey';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { breathe, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, type, wash, washInk } from '@/theme/tokens';

export type ChatRowState = 'active' | 'waiting' | 'completed' | 'wiped';

/** The new-message dot: one slow swell when it appears, then still (board `dotOnce`). */
function NewDot({ label }: { label: string }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const swell = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    swell.value = withDelay(
      breathe.period / 5,
      withSequence(
        withTiming(1, { duration: breathe.period / 2, easing: easing.breathe }),
        withTiming(0, { duration: breathe.period / 2, easing: easing.breathe }),
      ),
    );
    // reason: plays once per mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + 0.5 * swell.value }],
    opacity: 1 - 0.25 * swell.value,
  }));
  return (
    <Animated.View
      accessibilityLabel={label}
      testID="row-new-dot"
      style={[styles.newDot, { backgroundColor: colors.accent, borderColor: colors.surface }, style]}
    />
  );
}

export function StateChip({ state, label }: { state: ChatRowState; label: string }) {
  const { colors } = useTheme();
  const look =
    state === 'active'
      ? { bg: wash.green, ink: washInk.green }
      : state === 'waiting'
        ? { bg: wash.orange, ink: washInk.orange }
        : { bg: colors.bgLavender, ink: colors.inkMuted };
  return (
    <View style={[styles.chip, { backgroundColor: look.bg }]} testID={`row-state-${state}`}>
      {state === 'waiting' ? <Ionicons name="time-outline" size={11} color={look.ink} /> : null}
      <Text style={[type.chip, { color: look.ink }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export function ChatRow({
  testID,
  avatarSeed,
  name,
  state,
  stateLabel,
  inTouch = false,
  secondLine,
  lastLine,
  quietLine,
  time,
  unread = false,
  unreadLabel,
  savedLabel,
  lockedLabel,
  accessibilityLabel,
  onPress,
}: {
  testID: string;
  avatarSeed: string;
  name: string;
  state: ChatRowState;
  stateLabel: string;
  inTouch?: boolean;
  /** "Your mentor · first talked as …" / "Waiting for … · they reply when free". */
  secondLine?: string | null;
  lastLine: string;
  /** A third, quieter line (the waiting row's "You: …"). */
  quietLine?: string | null;
  time: string;
  unread?: boolean;
  unreadLabel: string;
  savedLabel?: string | null;
  lockedLabel?: string | null;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const wiped = state === 'wiped';
  const showFoot = state === 'active' || Boolean(savedLabel) || Boolean(lockedLabel);

  return (
    <PressKey
      onPress={onPress}
      edge={wiped ? colors.edgeAlt : colors.edgeSurface}
      radius={radius.lg}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={[
        styles.row,
        { backgroundColor: wiped ? colors.surfaceAlt : colors.surface, borderColor: colors.border },
        showFoot || secondLine ? styles.rowTop : null,
      ]}
    >
      <View>
        <MentorAvatar seed={avatarSeed} size={52} />
        {unread ? <NewDot label={unreadLabel} /> : null}
      </View>
      <View style={styles.body}>
        <View style={styles.headline}>
          <Text style={[styles.name, { color: colors.ink }]} numberOfLines={1}>
            {name}
          </Text>
          {inTouch ? <InTouchBadge still /> : null}
          {state !== 'active' ? <StateChip state={state} label={stateLabel} /> : null}
          <Text style={[type.micro, styles.time, { color: colors.inkMuted }]} numberOfLines={1}>
            {time}
          </Text>
        </View>
        {secondLine ? (
          <Text
            style={[state === 'waiting' ? type.note : type.micro, { color: state === 'waiting' ? colors.ink : colors.inkMuted }]}
            numberOfLines={state === 'waiting' ? 2 : 1}
          >
            {secondLine}
          </Text>
        ) : null}
        {state === 'waiting' ? null : (
          <Text
            style={[styles.last, unread ? styles.lastUnread : null, { color: unread ? colors.ink : colors.inkMuted }]}
            numberOfLines={1}
          >
            {lastLine}
          </Text>
        )}
        {quietLine ? (
          <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={1}>
            {quietLine}
          </Text>
        ) : null}
        {showFoot ? (
          <View style={styles.foot}>
            {state === 'active' ? <StateChip state="active" label={stateLabel} /> : null}
            {savedLabel ? (
              <View style={styles.saved}>
                <Ionicons name="bookmark-outline" size={13} color={colors.accent} />
                <Text style={[styles.savedText, { color: colors.accent }]}>{savedLabel}</Text>
              </View>
            ) : null}
            {lockedLabel ? (
              <View style={styles.saved}>
                <Ionicons name="lock-closed-outline" size={13} color={colors.inkMuted} />
                <Text style={[styles.savedText, { color: colors.inkMuted }]}>{lockedLabel}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </PressKey>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingLeft: 10,
    paddingRight: 14,
    borderWidth: 1,
  },
  rowTop: { alignItems: 'flex-start' },
  body: { flex: 1, minWidth: 0, gap: 1 },
  headline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 22, flexShrink: 1 },
  time: { flexGrow: 1, textAlign: 'right' },
  last: { fontFamily: font.sans, fontSize: 14, lineHeight: 20 },
  lastUnread: { fontFamily: font.sansSemi },
  foot: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 3 },
  chip: {
    height: 20,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: radius.pill,
    flexShrink: 0,
  },
  saved: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  savedText: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16 },
  newDot: {
    position: 'absolute',
    right: -1,
    top: -1,
    width: 14,
    height: 14,
    borderRadius: radius.pill,
    borderWidth: 2,
  },
});

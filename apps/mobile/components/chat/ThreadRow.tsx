/**
 * ThreadRow — one row of the hand-rolled member thread (web chat), drawn as board A05:
 *   - the member's words on an accent pillow bubble with its tail bottom-right, the
 *     mentor's on a white one with its tail bottom-left — no avatars, no per-message clock;
 *   - a plain bold day label above the first message of a day;
 *   - ONE quiet delivery line, under the member's latest message ("Read" / "Delivered" /
 *     "Delivered · 3 in a row");
 *   - the talk → action loop on a mentor bubble: the "Save to Mentor Notes" key rests under
 *     the mentor's latest message (and under any older one the member taps); once the
 *     server has the note, the key is replaced by a small "Saved" chip that settles on the
 *     bubble's top-right corner.
 *
 * Arrival (FINAL_SPEC): the rows on screen when the chat opens rise in reading order,
 * one stagger unit apart; a message that arrives live rises more slowly, and a mentor's
 * carries one soft ring that swells and fades. Transform + opacity only, manual shared
 * values; reduced motion = a short opacity fade for live rows and nothing else.
 *
 * Memoized with primitive props so composer keystrokes and typing events never re-render
 * the transcript.
 */
import { memo, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { Bubble, BubbleText, BUBBLE_PAD_X, BUBBLE_PAD_Y } from '@/components/chat/Bubble';
import { SaveKey } from '@/components/chat/SaveKey';
import { SavedChip } from '@/components/chat/SavedChip';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { chat as chatMotion, duration, easing, press, stagger } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, type } from '@/theme/tokens';

export type ThreadMsg = { id: string; text: string; mine: boolean; at: string };

const RISE = 16;
const GLOW_REACH = 6;

type Props = {
  item: ThreadMsg;
  /** Day label when this row starts a new day, else null. */
  dayText: string | null;
  /** The delivery line, only on the member's latest message. */
  statusText: string | null;
  /** 'history' = on screen as the chat opened; 'live' = arrived while it was open. */
  arrival: 'history' | 'live' | null;
  /** Reading-order step for a history arrival (0-based, already capped by the screen). */
  arrivalStep: number;
  /** The save key rests under this mentor bubble. */
  saveOpen: boolean;
  /** …with the one-line nudge beneath it (the mentor's latest message only). */
  nudge: boolean;
  isSaved: boolean;
  /** Saved during this visit: the chip settles in. Already-saved history is simply there. */
  savedNow: boolean;
  onToggleSave: (id: string) => void;
  onSave: (m: ThreadMsg) => void;
  onArrived: (id: string) => void;
};

export const ThreadRow = memo(function ThreadRow({
  item,
  dayText,
  statusText,
  arrival,
  arrivalStep,
  saveOpen,
  nudge,
  isSaved,
  savedNow,
  onToggleSave,
  onSave,
  onArrived,
}: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const reduced = useReducedMotion();
  // Latched at mount: the screen forgets an arrival once it has played (so a recycled row
  // never replays it), and the ring must not unmount halfway through its fade.
  const arrivedAs = useRef(arrival).current;
  const live = arrivedAs === 'live';
  // History is simply there under reduced motion; a live message still fades in briefly.
  const animate = arrivedAs !== null && !(reduced && !live);
  const rise = useSharedValue(animate ? 0 : 1);
  const glow = useSharedValue(0);

  useEffect(() => {
    if (rise.value === 1) return;
    if (reduced) {
      rise.value = withTiming(1, { duration: press.reduced });
    } else if (live) {
      rise.value = withTiming(1, { duration: duration.slow, easing: easing.settle });
      if (!item.mine) {
        glow.value = withDelay(
          duration.base,
          withSequence(
            withTiming(1, { duration: chatMotion.glow * chatMotion.glowPeakAt, easing: easing.settle }),
            withTiming(0, { duration: chatMotion.glow * (1 - chatMotion.glowPeakAt), easing: easing.settle }),
          ),
        );
      }
    } else {
      rise.value = withDelay(
        arrivalStep * stagger.unit,
        withTiming(1, { duration: duration.gentle, easing: easing.settle }),
      );
    }
    onArrived(item.id);
    // reason: an arrival plays exactly once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const riseStyle = useAnimatedStyle(() => ({
    opacity: rise.value,
    transform: [{ translateY: reduced ? 0 : RISE * (1 - rise.value) }],
  }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.value }));

  return (
    <Animated.View style={riseStyle}>
      {dayText ? (
        <Text style={[styles.day, { color: colors.inkMuted }]} testID="chat-day-label">
          {dayText}
        </Text>
      ) : null}

      {item.mine ? (
        <View style={styles.mineWrap}>
          <Bubble mine text={item.text} containerStyle={styles.mineBubbleWrap} testID={`mine-${item.id}`} />
          {statusText ? (
            <Text style={[styles.status, { color: colors.inkMuted }]} testID="chat-delivery">
              {statusText}
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={styles.theirsWrap}>
          <View style={[styles.bubbleWrap, isSaved && styles.roomForChip]}>
            {live && !reduced ? (
              <Animated.View
                pointerEvents="none"
                style={[styles.glow, { backgroundColor: colors.accentTint }, glowStyle]}
              />
            ) : null}
            <PressKey
              onPress={() => onToggleSave(item.id)}
              edge={colors.edgeSurface}
              travel={3}
              radius={radius.lg}
              haptic="none"
              faceRadiusStyle={{ borderBottomLeftRadius: radius.sm }}
              accessibilityHint={t('chat.actionsHintA11y')}
              testID={`msg-${item.id}`}
              style={[styles.bubble, styles.theirs, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <BubbleText mine={false} text={item.text} />
            </PressKey>
            {isSaved ? (
              <View style={styles.chipSeat} pointerEvents="none">
                <SavedChip settle={savedNow} testID={`saved-${item.id}`} />
              </View>
            ) : null}
          </View>

          {saveOpen && !isSaved ? (
            <SaveKey
              onPress={() => onSave(item)}
              nudge={nudge}
              delay={live ? duration.slow : 0}
              testID={`save-card-${item.id}`}
            />
          ) : null}
        </View>
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  day: { alignSelf: 'center', fontFamily: font.sansBold, fontSize: 13, lineHeight: 18, marginBottom: 10 },
  bubble: { paddingHorizontal: BUBBLE_PAD_X, paddingVertical: BUBBLE_PAD_Y },
  theirs: { borderWidth: 1 },
  bubbleWrap: { maxWidth: '80%', flexShrink: 1, alignSelf: 'flex-start' },
  // The width cap lives in Bubble now, as a number (see its header) — don't re-add a
  // percentage here or it overrides the pixel value the shared component computes.
  mineBubbleWrap: { flexShrink: 1 },
  // The chip sits on the bubble's top-right corner, 2px proud of it.
  roomForChip: { paddingTop: 8 },
  chipSeat: { position: 'absolute', right: 14, top: -2 },
  mineWrap: { alignItems: 'flex-end', gap: 4 },
  status: { fontFamily: font.sans, fontSize: 12, lineHeight: 16, paddingRight: 6 },
  theirsWrap: { alignItems: 'flex-start', gap: 8 },
  glow: {
    position: 'absolute',
    left: -GLOW_REACH,
    right: -GLOW_REACH,
    top: -GLOW_REACH,
    bottom: -GLOW_REACH + 3, // the bubble's pillow edge is not part of the ring
    borderRadius: radius.lg + GLOW_REACH,
    borderBottomLeftRadius: radius.sm + GLOW_REACH,
  },
});

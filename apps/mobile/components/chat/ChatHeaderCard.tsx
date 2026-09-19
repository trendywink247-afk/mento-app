/**
 * ChatHeaderCard — the member chat's header (DECISIONS §L.8, board A05 "alive"): ONE
 * floating pillow card holding the back key, the mentor's identity (avatar inside a
 * presence ring, name, status line — tapping it opens the mentor profile), the options
 * key and, as the bottom of the same card, the "In this chat" strip.
 *
 * Shared by both platforms (native Stream-kit chat and the hand-rolled web chat), so it
 * is purely presentational: the screens own navigation and `lib/useChatHeader.ts` owns
 * the data. It never invents state —
 *   - `status` null (not loaded / unknown) renders no ring, no dot and a plain "Mentor";
 *   - the strip renders only the chips that have something true to say, and not at all
 *     when there are none (no empty bar). The In touch chip (§L.6–7) is not built
 *     server-side, so it is not here.
 *
 * Motion: a header drop-in, staggered chips, one presence ripple at breathing tempo —
 * transform/opacity only, tokens only; reduced motion = a still ring, no loop.
 */
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useId } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { COMPANION_COLORS } from '@/theme/companion';
import { breathe, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, wash } from '@/theme/tokens';

const AVATAR = 56;
const RING_GAP = 4; // the ring sits this far outside the avatar
const RING_REACH = 0.14; // how far the ripple swells before it has faded out
const RING_REST_OPACITY = 0.35;
const KEY = 44; // back + options keys: the minimum comfortable tap target
const GLOW_HEIGHT = 300;
const GLOW_BLEED = 60;

type Props = {
  /** The mentor's persona name as it should read in the header. */
  name: string;
  /** The mentor's availability; `null` while unknown — never assumed. */
  status: 'online' | 'away' | 'offline' | null;
  /** The mentor snoozed this chat (board A10): the status reads "Mentor · replies within a
   * day" instead of here / away — the kind half only, never "snoozed". */
  replyWithinADay?: boolean;
  /** The mentor's community as a member reads it ("UPSC"), when they have one. */
  community?: string | null;
  /** The conversation's topic as the server words it for a member ("Exam stress" —
   * `issue_category_label`). Null when the chat was started without one: no chip. */
  topic?: string | null;
  /** Mentor notes saved from this conversation; the chip hides at 0. */
  savedCount: number;
  onBack: () => void;
  onOpenProfile: () => void;
  onOpenOptions: () => void;
};

/** One soft ripple leaving the avatar at breathing tempo — "someone is here". */
function PresenceRing({ color }: { color: string }) {
  const reduced = useReducedMotion();
  const ripple = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      cancelAnimation(ripple);
      ripple.value = 0;
      return;
    }
    ripple.value = withRepeat(
      withTiming(1, { duration: breathe.period / 2, easing: easing.settle }),
      -1,
      false,
    );
    return () => cancelAnimation(ripple);
  }, [reduced, ripple]);

  const style = useAnimatedStyle(() => ({
    opacity: RING_REST_OPACITY * (1 - ripple.value),
    transform: [{ scale: 1 + RING_REACH * ripple.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      testID="presence-ring"
      style={[styles.ring, { borderColor: color }, style]}
    />
  );
}

/** A pale wash of the member's accent behind the card — light, not an object. Static. */
function HeaderGlow({ color }: { color: string }) {
  const insets = useSafeAreaInsets();
  // reason: SVG gradient ids are document-global on web — two mounted headers (a chat
  // under a pushed screen) must not share one.
  const id = `chat-header-glow-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    // Absolutely positioned, so SafeAreaView's padding does not apply to it (CLAUDE.md
    // gotcha) — the glow is centred on the screen's real top edge via the inset.
    <View pointerEvents="none" style={[styles.glow, { top: -(GLOW_HEIGHT / 2) - insets.top }]}>
      <Svg width="100%" height={GLOW_HEIGHT} viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={color} stopOpacity={1} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100" height="100" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

export function ChatHeaderCard({
  name,
  status,
  replyWithinADay = false,
  community,
  topic,
  savedCount,
  onBack,
  onOpenProfile,
  onOpenOptions,
}: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const online = status === 'online';

  const statusLine = [
    replyWithinADay
      ? t('replyWindow.header')
      : status === null
        ? t('chat.header.mentor')
        : online
          ? t('chat.header.here')
          : t('chat.header.away'),
    community,
  ]
    .filter(Boolean)
    .join(' · ');

  const showStrip = Boolean(topic) || savedCount > 0;

  return (
    <View style={styles.wrap}>
      <HeaderGlow color={colors.accentTint} />
      <Entrance from="down" distance={14}>
        <EdgeSurface
          edge={colors.edgeSurface}
          travel={4}
          radius={radius.lg}
          testID="chat-header-card"
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={styles.row}>
            {/* reason: the back key and the identity area are chrome INSIDE the card, not
                cards of their own — face + edge are both colors.surface (no visible lip),
                so the pillow travel + haptic on press are the cue that they are tappable. */}
            <PressKey
              onPress={onBack}
              edge={colors.surface}
              travel={3}
              intent="navigate"
              radius={radius.pill}
              testID="chat-back"
              accessibilityLabel={t('chat.leaveA11y')}
              style={[styles.key, { backgroundColor: colors.surface }]}
            >
              <Ionicons name="chevron-back" size={24} color={colors.ink} />
            </PressKey>

            <PressKey
              onPress={onOpenProfile}
              edge={colors.surface}
              travel={2}
              intent="navigate"
              radius={radius.md}
              testID="mentor-header"
              accessibilityLabel={t('chat.mentorHeaderA11y', { name })}
              style={[styles.identity, { backgroundColor: colors.surface }]}
              containerStyle={styles.identityContainer}
            >
              <View style={styles.avatarBox}>
                {online ? <PresenceRing color={colors.accent} /> : null}
                <View style={[styles.avatarFrame, { borderColor: colors.surface }]}>
                  <PersonaAvatar name={name} size={AVATAR - 4} />
                </View>
                {online ? (
                  // Decorative: the status line below says the same thing in words.
                  <View
                    testID="presence-dot"
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                    style={[styles.dot, { backgroundColor: colors.success, borderColor: colors.surface }]}
                  />
                ) : null}
              </View>
              <View style={styles.identityText}>
                <Text style={[styles.name, { color: colors.ink }]} numberOfLines={1}>
                  {name}
                </Text>
                <Text
                  style={[type.caption, { color: colors.inkMuted }]}
                  numberOfLines={1}
                  testID="chat-header-status"
                >
                  {statusLine}
                </Text>
              </View>
            </PressKey>

            <PressKey
              onPress={onOpenOptions}
              edge={colors.edgeAlt}
              travel={3}
              intent="navigate"
              radius={radius.pill}
              testID="open-options"
              accessibilityLabel={t('chat.optionsA11y')}
              style={[styles.key, styles.optionsKey, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
            >
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.ink} />
            </PressKey>
          </View>

          {showStrip ? (
            <View
              testID="chat-strip"
              style={[styles.strip, { backgroundColor: colors.surfaceAlt, borderTopColor: colors.border }]}
            >
              <Entrance index={2} distance={6}>
                <Text style={[styles.stripLabel, { color: colors.inkMuted }]}>{t('chat.header.inThisChat')}</Text>
              </Entrance>
              {topic ? (
                <Entrance index={3} distance={6}>
                  <View style={[styles.chip, { backgroundColor: wash.orange }]} testID="chat-strip-topic">
                    <Text style={[styles.chipText, { color: COMPANION_COLORS.mustard.accentEdge }]} numberOfLines={1}>
                      {topic}
                    </Text>
                  </View>
                </Entrance>
              ) : null}
              {savedCount > 0 ? (
                <Entrance index={4} distance={6}>
                  <View
                    style={[styles.chip, styles.chipWithIcon, { backgroundColor: wash.green }]}
                    testID="chat-strip-saved"
                    accessible
                    accessibilityLabel={t('chat.header.savedA11y', { count: savedCount })}
                  >
                    <Ionicons name="bookmark" size={12} color={COMPANION_COLORS.sage.accentEdge} />
                    <Text style={[styles.chipText, { color: COMPANION_COLORS.sage.accentEdge }]}>
                      {t('chat.header.saved', { count: savedCount })}
                    </Text>
                  </View>
                </Entrance>
              ) : null}
            </View>
          ) : null}
        </EdgeSurface>
      </Entrance>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.sm + 4, paddingTop: space.sm, paddingBottom: space.xs, zIndex: 3 },
  glow: { position: 'absolute', left: -GLOW_BLEED, right: -GLOW_BLEED, height: GLOW_HEIGHT },
  // overflow: the strip's flat top edge and tinted ground are clipped to the card's corners.
  card: { borderWidth: 1, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    paddingVertical: space.sm,
    paddingRight: space.sm,
    paddingLeft: space.xs,
  },
  key: { width: KEY, height: KEY, alignItems: 'center', justifyContent: 'center' },
  optionsKey: { borderWidth: 1 },
  identityContainer: { flex: 1, minWidth: 0 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 4, minHeight: AVATAR },
  avatarBox: { width: AVATAR, height: AVATAR },
  ring: {
    position: 'absolute',
    top: -RING_GAP,
    right: -RING_GAP,
    bottom: -RING_GAP,
    left: -RING_GAP,
    borderRadius: radius.pill,
    borderWidth: 2,
  },
  avatarFrame: {
    width: AVATAR,
    height: AVATAR,
    borderRadius: radius.pill,
    borderWidth: 2,
    overflow: 'hidden',
  },
  dot: {
    position: 'absolute',
    right: 0,
    bottom: 1,
    width: 14,
    height: 14,
    borderRadius: radius.pill,
    borderWidth: 2.5,
  },
  identityText: { flex: 1, minWidth: 0 },
  name: { fontFamily: font.sansHeavy, fontSize: 19, lineHeight: 24 },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 42,
    paddingHorizontal: space.sm + 4,
    borderTopWidth: 1,
    overflow: 'hidden',
  },
  stripLabel: {
    fontFamily: font.sansBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  chip: {
    height: 26,
    paddingHorizontal: space.sm + 2,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipWithIcon: { gap: space.xs, paddingLeft: space.sm },
  chipText: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16 },
});

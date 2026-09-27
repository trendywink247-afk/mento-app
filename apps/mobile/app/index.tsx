import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import LottieView from 'lottie-react-native';

import { SCENES } from '@/assets/scenes';
import { PrimaryButton } from '@/components/PrimaryButton';
import { HandUnderline } from '@/components/art/HandUnderline';
import { LogoWordmark } from '@/components/art/Logo';
import { FloatingChatCard } from '@/components/landing/FloatingChatCard';
import { Entrance } from '@/components/motion/Entrance';
import { GroundGlow } from '@/components/motion/GroundGlow';
import { PressKey } from '@/components/motion/PressKey';
import { Stage } from '@/components/motion/Stage';
import { capture } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';
import { hasPendingTap } from '@/lib/notifications';
import { useFrameSize } from '@/lib/useFrameSize';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { getRole, getSessionToken } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import { duration, easing, forkArrival } from '@/theme/motion';
import { radius, space, type } from '@/theme/tokens';

/** Board A01 metrics (390×844). */
const TOP_PAD = 44;
const BOTTOM_PAD = 28;
const WORDMARK_H = 40;
const STAGE_GAP = 26;
const STAGE_MAX = 360;
const STAGE_MIN = 200;
const STAGE_SIDE = 15;
const STAGE_AIR = 34;
const TEXT_BLOCK_ESTIMATE = 308;
const CARD_SIDE = 14;
const CARD_LAP_MAX = 12;
/** Where the drawing sits inside the square 1200² Lottie canvas (measured on frame 0): it
 * spans this share of the width, and its ground line is this far down the side. */
const LOTTIE_BAND = { width: 0.775, ground: 0.869 };

/** Landing — board A01. The conversation scene (the live Lottie) stands on a round lit
 * STAGE: accent-tint disc, two very slow counter-rotating dotted rings, three breathing
 * ripples, a slow sheen, a few motes, and two chat cards hovering over it. Below, the
 * left-aligned hero headline rises line by line, the last word underlined by hand, then
 * the sub, the CTA and the not-therapists line. No animals here (founder ruling): the
 * companions arrive on the inner screens. The sky is the same ambient aurora the journey
 * lives on, and the CTA exit is a designed fade into the journey's route crossfade.
 * Returning-user redirect unchanged. */
export default function Landing() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  // The frame, not the window: on a wide browser the app draws into a 480 column.
  const { width, height } = useFrameSize();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  // The text block is measured so the stage takes exactly the room that is left —
  // Hindi wraps differently and short phones have less of it.
  const [textH, setTextH] = useState(TEXT_BLOCK_ESTIMATE);
  const [wordW, setWordW] = useState(0);
  const [memberCard, setMemberCard] = useState({ w: 0, h: 0 });
  const [mentorCard, setMentorCard] = useState({ w: 0, h: 0 });
  // Returning users (existing anonymous session) skip onboarding and land on My Chats;
  // render nothing while the secure store resolves so the landing never flashes first.
  const [checked, setChecked] = useState(false);
  // Web DotLottie throws (ImageData width 0) if its canvas is alive during route
  // teardown, so WEB swaps to the still scene — but only once the exit fade has made
  // the hero invisible. Swapping at the tap (and on native, which never needed it) put
  // a different picture on screen for the whole fade (session 35, frame capture).
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let active = true;
    void getSessionToken().then(async (token) => {
      if (!active) return;
      if (token) {
        const role = await getRole();
        // A cold-start notification tap is already routing us somewhere specific —
        // don't let this generic redirect clobber it (see lib/notifications.ts).
        if (active && !hasPendingTap()) router.replace(role === 'mentor' ? '/mentor-home' : '/chats');
      } else setChecked(true);
    });
    return () => {
      active = false;
    };
  }, [router]);

  // Funnel head — only once the landing is actually shown (returning users
  // redirect away before `checked` and never count).
  useEffect(() => {
    if (checked) capture('landing_viewed');
  }, [checked]);

  // Designed exit (board T01): the landing leaves fast and upward — the words lift away,
  // the key dips, the cards tuck in — while the scene lifts and shrinks on a longer move
  // that carries on under the fork's own arrival. Then the route crossfade takes over.
  const exit = useSharedValue(0);
  const lift = useSharedValue(0);
  const textExit = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    transform: [{ translateY: -forkArrival.textLift * exit.value }],
  }));
  const ctaExit = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    transform: [{ scale: 1 - (1 - forkArrival.ctaScale) * exit.value }],
  }));
  const cardExit = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    transform: [
      { translateY: -forkArrival.cardLift * exit.value },
      { scale: 1 - (1 - forkArrival.cardScale) * exit.value },
    ],
  }));
  const sceneExit = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    transform: [
      { translateY: -forkArrival.sceneLift * lift.value },
      { scale: 1 - (1 - forkArrival.sceneScale) * lift.value },
    ],
  }));
  // The exit fade + `leaving` swap outlive the push (the landing stays mounted
  // under the onboarding route), so restore both whenever focus returns —
  // otherwise navigating back lands on an invisible hero over bare sky.
  // Also re-check the session on focus: a signed-in user must never sit on the
  // pre-session landing (mirrors the cold-start redirect above).
  useFocusEffect(
    useCallback(() => {
      exit.value = 0;
      lift.value = 0;
      setLeaving(false);
      let active = true;
      void getSessionToken().then(async (token) => {
        if (!active || !token) return;
        const role = await getRole();
        // Same pending-tap guard as the mount effect above.
        if (active && !hasPendingTap()) router.replace(role === 'mentor' ? '/mentor-home' : '/chats');
      });
      return () => {
        active = false;
      };
    }, [exit, lift, router]),
  );

  const begin = () => {
    capture('onboarding_started');
    // Reduced motion already shows the still scene; native has no canvas to protect.
    // Web pushes from the `leaving` effect below, after the still has committed.
    const go = () => (Platform.OS === 'web' && !reduced ? setLeaving(true) : router.push('/onboarding'));
    if (reduced) {
      go();
      return;
    }
    lift.value = withTiming(1, { duration: duration.gentle, easing: easing.exit });
    exit.value = withTiming(1, { duration: duration.fast + 50, easing: easing.exit }, (done) => {
      if (done) runOnJS(go)();
    });
  };

  // Runs after the commit that unmounted the Lottie canvas — the push is now safe.
  useEffect(() => {
    if (leaving) router.push('/onboarding');
  }, [leaving, router]);

  if (!checked) return null;

  // Board geometry at 390×844: 44 top, wordmark 40, the 360 stage at y=110 (26 under the
  // wordmark), the text block pinned to the bottom with at least 34 of air above it.
  const topPad = Math.max(insets.top + space.sm, TOP_PAD);
  const bottomPad = Math.max(insets.bottom + space.sm, BOTTOM_PAD);
  const stageTop = topPad + WORDMARK_H + STAGE_GAP;
  const room = height - stageTop - textH - bottomPad - STAGE_AIR;
  const stageSize = Math.round(Math.max(STAGE_MIN, Math.min(STAGE_MAX, width - STAGE_SIDE * 2, room)));
  const k = stageSize / STAGE_MAX;
  const stageLeft = (width - stageSize) / 2;
  // The scene box on the board: 350×208 at (5, 112) inside the 360 stage.
  const sceneW = 350 * k;
  const sceneH = 208 * k;
  const lottieSide = sceneW / LOTTIE_BAND.width;
  // The cards may share a corner (on the board the reply card laps 34px over the first
  // card's padding). On a narrower phone or in a longer language they would cover each
  // other's words — then the first card steps down until it clears the reply card.
  const mentorTop = stageTop - 14;
  const cardMax = (width - CARD_SIDE * 2) * 0.66;
  const lap = memberCard.w + mentorCard.w - (width - CARD_SIDE * 2);
  const memberTop =
    lap > CARD_LAP_MAX ? Math.max(stageTop + 22 * k, mentorTop + mentorCard.h + space.xs) : stageTop + 22 * k;

  return (
    <View style={styles.root}>
      <View style={styles.fill}>
        {/* The stage has no arrival — it is simply already there, which reads as continuity. */}
        <Animated.View style={[styles.stage, { top: stageTop, left: stageLeft }, sceneExit]} pointerEvents="none">
          <Stage size={stageSize} rings={2} ripples sheen motes />
          <View
            style={[styles.scene, { left: 5 * k, top: 112 * k, width: sceneW, height: sceneH }]}
            accessible
            accessibilityRole="image"
            accessibilityLabel={t('landing.sceneA11y')}
          >
            <View style={[styles.glow, { left: 30 * k, bottom: -12 * k }]}>
              <GroundGlow width={sceneW - 60 * k} height={26 * k} />
            </View>
            {/* The file is a 1200² canvas whose drawing is a band in its lower middle, so the
              * box is oversized and lifted until the DRAWING fills the board's scene box
              * and stands on its bottom edge. The still uses the very same box. */}
            <View
              style={[
                styles.lottie,
                {
                  width: lottieSide,
                  height: lottieSide,
                  left: (sceneW - lottieSide) / 2,
                  top: sceneH - lottieSide * LOTTIE_BAND.ground,
                },
              ]}
            >
              {reduced || leaving ? (
                // Reduced motion (no looping art) or exiting (see `leaving`): frame 0 of the
                // same animation, so the swap cannot be seen.
                <Image source={SCENES.landingStill} style={styles.lottieFill} resizeMode="contain" />
              ) : (
                // Theme-remapped free Lottie (assets/lottie/README.md) — two people in
                // conversation, alive, in Mento's own palette.
                <LottieView
                  source={require('@/assets/lottie/study-discussion.json')}
                  autoPlay
                  loop
                  style={styles.lottieFill}
                  // reason: on web LottieView ignores `style` and sizes from
                  // webStyle (DotLottieReact) — both are needed for one layout.
                  webStyle={{ width: '100%', height: '100%' }}
                />
              )}
            </View>
          </View>
        </Animated.View>

        {/* The two chat cards hover over the stage's top corners (board: 14 from each edge). */}
        <View
          style={[styles.cardMember, { top: memberTop, maxWidth: cardMax }]}
          pointerEvents="none"
          onLayout={(e) => setMemberCard({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        >
          <Entrance index={3}>
            <Animated.View style={[styles.cardOriginMember, cardExit]}>
              <FloatingChatCard side="member" text={t('landing.cardMember')} />
            </Animated.View>
          </Entrance>
        </View>
        <View
          style={[styles.cardMentor, { top: mentorTop, maxWidth: cardMax }]}
          pointerEvents="none"
          onLayout={(e) => setMentorCard({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        >
          <Entrance index={6}>
            <Animated.View style={[styles.cardOriginMentor, cardExit]}>
              <FloatingChatCard side="mentor" text={t('landing.cardMentor')} />
            </Animated.View>
          </Entrance>
        </View>

        <View style={[styles.column, { paddingTop: topPad, paddingBottom: bottomPad }]}>
          <Entrance index={0}>
            <Animated.View style={textExit}>
              <LogoWordmark />
            </Animated.View>
          </Entrance>

          <View style={styles.grow} />

          <View onLayout={(e) => setTextH(e.nativeEvent.layout.height)} style={styles.textBlock}>
            <Animated.View style={[styles.copy, textExit]}>
              <View
                accessible
                accessibilityRole="header"
                accessibilityLabel={`${t('landing.headline1')} ${t('landing.headline2')} ${t('landing.headline3')}`}
              >
                <Entrance index={1}>
                  <Text style={[type.displayHero, styles.headline, { color: colors.ink }]}>
                    {t('landing.headline1')}
                  </Text>
                </Entrance>
                <Entrance index={2}>
                  <Text style={[type.displayHero, styles.headline, { color: colors.ink }]}>
                    {t('landing.headline2')}
                  </Text>
                </Entrance>
                <Entrance index={3} style={styles.lastWord}>
                  <Text
                    onLayout={(e) => setWordW(e.nativeEvent.layout.width)}
                    style={[type.displayHero, styles.headline, { color: colors.accent }]}
                  >
                    {t('landing.headline3')}
                  </Text>
                  <View style={styles.underline}>
                    <HandUnderline width={wordW} color={colors.accent} />
                  </View>
                </Entrance>
              </View>
              <Entrance index={4}>
                <Text style={[type.body, { color: colors.inkMuted }]}>{t('landing.sub')}</Text>
              </Entrance>
            </Animated.View>

            <Entrance index={5} style={styles.ctaBlock}>
              {/* The CTA floats on a soft accent glow — a floating layer, so a shadow belongs. */}
              <Animated.View style={[styles.ctaGlow, { shadowColor: colors.accent }, ctaExit]}>
                <PrimaryButton
                  label={t('landing.cta')}
                  shape="key"
                  trailing="arrow"
                  onPress={begin}
                  accessibilityHint={t('landing.ctaHint')}
                  testID="start"
                />
              </Animated.View>
              <Animated.Text style={[type.caption, styles.footer, { color: colors.inkMuted }, textExit]}>
                {t('landing.footer')}
              </Animated.Text>
              {/* Back on a new phone (WS3 T3.5): the one way in for an account that has no
                  email or password. Quiet — a link, never a second CTA. */}
              <Animated.View style={textExit}>
                <PressKey
                  onPress={() => router.push('/recover')}
                  edge="transparent"
                  travel={2}
                  radius={radius.sm}
                  accessibilityRole="link"
                  accessibilityLabel={t('recovery.landingLink')}
                  testID="landing-recover"
                  containerStyle={styles.recoverBox}
                  style={styles.recover}
                >
                  <Text style={[type.caption, { color: colors.accentEdge }]}>{t('recovery.landingLink')}</Text>
                </PressKey>
              </Animated.View>
            </Entrance>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Clipped: the stage's shadow and the floating cards may reach past the edges, and a
  // page wider than the viewport can be dragged sideways on phone browsers.
  root: { flex: 1, overflow: 'hidden' },
  fill: { flex: 1 },
  stage: { position: 'absolute' },
  scene: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute' },
  lottie: { position: 'absolute' },
  lottieFill: { width: '100%', height: '100%' },
  cardOriginMember: { transformOrigin: 'left bottom' },
  cardOriginMentor: { transformOrigin: 'right bottom' },
  cardMember: { position: 'absolute', left: CARD_SIDE },
  cardMentor: { position: 'absolute', right: CARD_SIDE },
  column: { flex: 1, paddingHorizontal: space.lg },
  recoverBox: { alignSelf: 'center', minHeight: 44, justifyContent: 'center' },
  recover: { paddingHorizontal: 8, paddingVertical: 2 },
  grow: { flex: 1 },
  textBlock: { gap: space.lg },
  copy: { gap: 12 },
  headline: { letterSpacing: -0.3 },
  lastWord: { alignSelf: 'flex-start' },
  underline: { position: 'absolute', left: 0, bottom: -4 },
  ctaBlock: { gap: space.md },
  ctaGlow: { shadowOpacity: 0.22, shadowRadius: 15, shadowOffset: { width: 0, height: 16 } },
  footer: { textAlign: 'center' },
});

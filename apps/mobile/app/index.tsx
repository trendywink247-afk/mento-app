import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/PrimaryButton';
import { LogoLockup } from '@/components/art/Logo';
import { MountainsScene, TalkingAtTableScene } from '@/components/art/Scenes';
import { AmbientBackground } from '@/components/motion/AmbientBackground';
import { SkyMotes } from '@/components/motion/SkyMotes';
import { Entrance } from '@/components/motion/Entrance';
import { Tilt3D } from '@/components/motion/Tilt3D';
import { useBreathing } from '@/components/motion/useBreathing';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { getSessionToken } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import { duration, easing } from '@/theme/motion';
import { font, radius, space, type } from '@/theme/tokens';

/** Landing per mockup #2, cinematic: the sky is the same ambient aurora the journey
 * lives on (one continuous shot), the logo breathes, the headline lines rise in a
 * stagger, the mountains drift almost imperceptibly, and the CTA exit is a designed
 * fade into the journey's route crossfade. Returning-user redirect unchanged. */
export default function Landing() {
  const router = useRouter();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
  const breathing = useBreathing();
  // Returning users (existing anonymous session) skip onboarding and land on My Chats;
  // render nothing while the secure store resolves so the landing never flashes first.
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    void getSessionToken().then((token) => {
      if (!active) return;
      if (token) router.replace('/chats');
      else setChecked(true);
    });
    return () => {
      active = false;
    };
  }, [router]);

  // Mountains drift ±8px over ~40s. Drawn 24px wider than the screen so the drift
  // never exposes an edge.
  const drift = useSharedValue(0);
  useEffect(() => {
    if (!checked || reduced) {
      cancelAnimation(drift);
      drift.value = 0;
      return;
    }
    drift.value = withRepeat(withTiming(8, { duration: 20000, easing: easing.breathe }), -1, true);
    return () => cancelAnimation(drift);
  }, [checked, reduced, drift]);
  const driftStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: drift.value - 4 }],
  }));

  // Designed exit: the hero fades down briefly, then the route crossfade takes over.
  const exit = useSharedValue(0);
  const exitStyle = useAnimatedStyle(() => ({
    opacity: 1 - exit.value,
    transform: [{ translateY: exit.value * -10 }],
  }));
  const begin = () => {
    const go = () => router.push('/onboarding');
    if (reduced) {
      go();
      return;
    }
    exit.value = withTiming(1, { duration: duration.fast + 50, easing: easing.exit }, (done) => {
      if (done) runOnJS(go)();
    });
  };

  if (!checked) return null;

  return (
    <View style={styles.root}>
      <AmbientBackground />
      <SkyMotes />
      <View style={styles.mountains} pointerEvents="none">
        <Animated.View style={driftStyle}>
          <MountainsScene width={width + 24} height={190} />
        </Animated.View>
      </View>

      <Animated.View style={[styles.fill, exitStyle]}>
        <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
          <View style={styles.logoZone}>
            <Entrance index={0} from="none">
              <Tilt3D maxTilt={5}>
                <Animated.View style={breathing}>
                  <LogoLockup markSize={56} />
                </Animated.View>
              </Tilt3D>
            </Entrance>
          </View>

          <View style={styles.sceneZone}>
            <Entrance index={1} from="none">
              {/* The hero scene sits in space — slightly deeper tilt than the logo,
                * so the two planes separate and the landing reads with depth. */}
              <Tilt3D maxTilt={3}>
                <TalkingAtTableScene width={300} height={200} />
              </Tilt3D>
            </Entrance>
          </View>

          <View style={styles.hero}>
            <View
              accessible
              accessibilityRole="header"
              accessibilityLabel="A place to talk with a peer who understands."
              style={styles.headlineBlock}
            >
              <Entrance index={1}>
                <Text style={[styles.headline, { color: colors.ink }]}>A place to talk</Text>
              </Entrance>
              <Entrance index={2}>
                <Text style={[styles.headline, { color: colors.ink }]}>with a peer who</Text>
              </Entrance>
              <Entrance index={3}>
                <Text style={[styles.headline, { color: colors.accentSoft }]}>understands.</Text>
              </Entrance>
            </View>
            <Entrance index={5}>
              <Text style={[type.body, styles.sub, { color: colors.inkMuted }]}>
                Anonymous. Judgment-free.{'\n'}Real conversations. When you need it most.
              </Text>
            </Entrance>
          </View>

          <View style={styles.ctaWrap}>
            <Entrance index={6}>
              <View style={[styles.ctaGlow, { shadowColor: colors.accent }]}>
                <PrimaryButton
                  label="Start a Conversation"
                  tone="ink"
                  icon="chatbubble-outline"
                  onPress={begin}
                  accessibilityHint="Begins anonymous onboarding"
                  testID="start"
                />
              </View>
            </Entrance>
          </View>
        </SafeAreaView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  fill: { flex: 1 },
  safe: { flex: 1, paddingHorizontal: space.lg },
  mountains: { position: 'absolute', left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  logoZone: { flex: 3, alignItems: 'center', justifyContent: 'flex-end' },
  sceneZone: { flex: 5, alignItems: 'center', justifyContent: 'center' },
  hero: { flex: 5, alignItems: 'center', justifyContent: 'center', gap: space.md },
  headlineBlock: { alignItems: 'center' },
  headline: {
    fontFamily: font.serifBold,
    fontSize: 34,
    lineHeight: 44,
    textAlign: 'center',
  },
  sub: { textAlign: 'center' },
  ctaWrap: { flex: 4, justifyContent: 'flex-start', paddingTop: space.sm },
  ctaGlow: {
    borderRadius: radius.pill,
    shadowOpacity: 0.35,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
});

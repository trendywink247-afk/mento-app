/**
 * Not found (board A39). Without this file expo-router renders its own black "Unmatched
 * Route" page — a stale share link or a typo would drop a struggling person onto a
 * developer error.
 *
 * Board: the quiet Feedback pill top-right; a road that stops at a small signpost, the
 * member's companion at its end leaning forward, curious, on an accent-tint disc inside one
 * dashed ring; "This road does not exist.", the reassurance, "Take me home" / "Go back".
 * The companion breathes (the board's 5.2 s lean); words and keys rise in reading order.
 * Reduced motion: all still.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, G, LinearGradient, Path, Stop } from 'react-native-svg';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Companion } from '@/components/art/Companion';
import { RadialWash } from '@/components/art/RadialWash';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { useHeroBreath } from '@/components/motion/useHeroBreath';
import { useI18n } from '@/lib/i18n';
import { leaveToChats } from '@/lib/leaveToChats';
import { useCompanionAnimal } from '@/lib/useCompanionAnimal';
import { useFrameSize } from '@/lib/useFrameSize';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS } from '@/theme/companion';
import { font, radius, space, type } from '@/theme/tokens';

/** The board draws the scene on a 390-wide frame; it scales with the frame below that. */
const BOARD_W = 390;
const SCENE_H = 330;

function Road({ width }: { width: number }) {
  const { colors } = useTheme();
  const k = width / BOARD_W;
  return (
    <Svg
      width={width}
      height={SCENE_H * k}
      viewBox={`-24 0 ${BOARD_W} ${SCENE_H}`}
      style={[styles.road, { left: -space.lg }]}
      pointerEvents="none"
    >
      <Defs>
        <LinearGradient id="a39fade" gradientUnits="userSpaceOnUse" x1="236" y1="0" x2="366" y2="0">
          <Stop offset="0" stopColor={colors.dashIdle} stopOpacity={1} />
          <Stop offset="1" stopColor={colors.dashIdle} stopOpacity={0.1} />
        </LinearGradient>
      </Defs>
      <Path fill="none" d="M-44 270 C 40 270, 76 292, 164 292" stroke={colors.edgeSurface} strokeWidth={34} strokeLinecap="round" />
      <Path fill="none" d="M-44 266 C 40 266, 76 288, 164 288" stroke={colors.surface} strokeWidth={34} strokeLinecap="round" />
      <Path
        fill="none"
        d="M-44 266 C 40 266, 76 288, 150 288"
        stroke={colors.dotIdle}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray="10 12"
      />
      <Path fill="none" d="M164 271 C 246 271, 284 254, 372 254" stroke="url(#a39fade)" strokeWidth={2} strokeLinecap="round" strokeDasharray="2 9" />
      <Path fill="none" d="M164 305 C 246 305, 284 288, 372 288" stroke="url(#a39fade)" strokeWidth={2} strokeLinecap="round" strokeDasharray="2 9" />
      <Path fill="none" d="M300 252 V190" stroke={colors.dashIdle} strokeWidth={5} strokeLinecap="round" />
      <G rotation={-4} origin="300, 202">
        <Path d="M272 193 h46 l12 12 -12 12 h-46 z" fill={colors.edgeSurface} stroke={colors.edgeSurface} strokeWidth={1.5} strokeLinejoin="round" />
        <Path d="M272 190 h46 l12 12 -12 12 h-46 z" fill={colors.surface} stroke={colors.edgeAlt} strokeWidth={1.5} strokeLinejoin="round" />
        <Path fill="none" d="M283 202 h28" stroke={colors.dotIdle} strokeWidth={2} strokeLinecap="round" strokeDasharray="2 6" />
      </G>
    </Svg>
  );
}

export default function NotFound() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const animal = useCompanionAnimal();
  const breath = useHeroBreath();
  const { width } = useFrameSize();
  const k = Math.min(1, width / BOARD_W);

  // Home is My Chats: back to the tabs already mounted when there are any, else through
  // `/` (which sends a live session on to /chats and anyone else to the landing).
  const home = () => (router.canDismiss() ? leaveToChats(router) : router.replace('/'));
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']} testID="not-found">
      <RadialWash
        pools={[
          { left: -260, top: -220, width: 640, height: 520, color: COMPANION_COLORS.sky.accent, opacity: 0.16 },
          { right: -300, top: 120, width: 600, height: 520, color: COMPANION_COLORS.plum.accent, opacity: 0.13 },
        ]}
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.top}>
          <PressKey
            onPress={() => router.push({ pathname: '/feedback', params: { from: '+not-found' } })}
            edge={colors.edgeSurface}
            travel={3}
            radius={radius.pill}
            accessibilityLabel={t('feedback.pillA11y')}
            testID="not-found-feedback"
            style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Ionicons name="chatbubble-outline" size={16} color={colors.inkMuted} />
            <Text style={[styles.pillText, { color: colors.inkMuted }]}>{t('feedback.pill')}</Text>
          </PressKey>
        </View>

        <View
          style={[styles.scene, { height: SCENE_H * k, paddingBottom: 34 * k }]}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('notFound.companionA11y')}
        >
          <View
            style={[
              styles.disc,
              { top: 34 * k, width: 236 * k, height: 236 * k, backgroundColor: colors.accentTint },
            ]}
          />
          <View
            style={[
              styles.ring,
              { top: 14 * k, width: 276 * k, height: 276 * k, borderColor: colors.accentTintEdge },
            ]}
          />
          <Road width={width} />
          <Animated.View style={[styles.feet, breath]}>
            <Companion animal={animal ?? null} size={200 * k} pose="curious" awake />
          </Animated.View>
        </View>

        <View style={styles.words}>
          <Entrance index={0}>
            <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
              {t('notFound.title')}
              <Text style={{ color: colors.accent }}>{t('notFound.titleAccent')}</Text>
              {t('notFound.titleEnd')}
            </Text>
          </Entrance>
          <Entrance index={1}>
            <Text style={[type.body, styles.center, { color: colors.inkMuted }]}>{t('notFound.body')}</Text>
          </Entrance>
        </View>

        <View style={styles.grow} />

        <View style={styles.keys}>
          <Entrance index={2}>
            <PrimaryButton label={t('notFound.home')} shape="key" icon="home-outline" onPress={home} testID="not-found-home" />
          </Entrance>
          <Entrance index={3}>
            <PrimaryButton
              label={t('notFound.back')}
              shape="key"
              variant="surface"
              dense
              icon="arrow-back"
              onPress={back}
              testID="not-found-back"
            />
          </Entrance>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, overflow: 'hidden' },
  scroll: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: 28 },
  top: { flexDirection: 'row', justifyContent: 'flex-end', minHeight: 44 },
  pill: {
    height: 44,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
  },
  pillText: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  scene: { alignItems: 'center', justifyContent: 'flex-end' },
  disc: { position: 'absolute', alignSelf: 'center', borderRadius: radius.pill },
  ring: { position: 'absolute', alignSelf: 'center', borderRadius: radius.pill, borderWidth: 1.5, borderStyle: 'dashed' },
  road: { position: 'absolute', top: 0 },
  feet: { transformOrigin: 'bottom' },
  words: { paddingTop: space.sm, gap: space.sm },
  title: { fontFamily: font.sansHeavy, fontSize: 30, lineHeight: 38, textAlign: 'center' },
  center: { textAlign: 'center' },
  grow: { flexGrow: 1, minHeight: 12 },
  keys: { gap: 14 },
});

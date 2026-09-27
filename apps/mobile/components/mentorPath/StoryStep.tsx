import Ionicons from '@expo/vector-icons/Ionicons';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { SCENES } from '@/assets/scenes';
import { EdgeSurface } from '@/components/EdgeSurface';
import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { LogoWordmark } from '@/components/art/Logo';
import { Entrance } from '@/components/motion/Entrance';
import { GroundGlow } from '@/components/motion/GroundGlow';
import { PressKey } from '@/components/motion/PressKey';
import { Stage } from '@/components/motion/Stage';
import { useI18n, type TKey } from '@/lib/i18n';
import { useFrameSize } from '@/lib/useFrameSize';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS } from '@/theme/companion';
import { radius, space, type, wash, washEdge } from '@/theme/tokens';

/** The landing scene file is a 1200² canvas whose drawing is a band in its lower middle
 * (same numbers as app/index.tsx) — the box is oversized so the DRAWING fills the scene. */
const BAND = { width: 0.775, ground: 0.869 };
/** Board A38: a 342×176 stage block, the 168 disc on a 196 ring, the 290×172 scene. */
const BLOCK_H = 176;
const RING = 196;
const SCENE_W = 290;
const SCENE_H = 172;
/** Room the sticky footer takes (fade + key + two lines), so the page scrolls clear of it. */
const FOOTER_ROOM = 150;

const ROWS: { icon: 'chatbubble-outline' | 'time-outline' | 'heart-outline'; tone: 'green' | 'orange' | 'indigo'; title: TKey; body: TKey }[] = [
  { icon: 'chatbubble-outline', tone: 'green', title: 'publicApply.row1Title', body: 'publicApply.row1Body' },
  { icon: 'time-outline', tone: 'orange', title: 'publicApply.row2Title', body: 'publicApply.row2Body' },
  { icon: 'heart-outline', tone: 'indigo', title: 'publicApply.row3Title', body: 'publicApply.row3Body' },
];

/** The mentor path's first screen for anyone who has not applied (board A38): what
 * mentoring is, the time it takes, that it is voluntary — over the landing's two-people
 * scene on the round stage (no animals: the founder keeps the human scene here). The same
 * story on the public web page (no session: the wordmark heads it and the footer says no
 * app is needed) and inside the app (a member from Profile, or a new mentor from the role
 * fork: a back key heads it instead). */
export function StoryStep({
  surface,
  onApply,
  onBack,
}: {
  surface: 'public' | 'member';
  onApply: () => void;
  onBack?: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { width } = useFrameSize();
  const block = Math.min(342, width - space.lg * 2);
  const sceneSide = SCENE_W / BAND.width;

  return (
    <View style={styles.root} testID="apply-page">
      <ScrollView contentContainerStyle={[styles.intro, { paddingBottom: FOOTER_ROOM }]} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          {surface === 'public' || !onBack ? (
            <LogoWordmark />
          ) : (
            <PressKey
              onPress={onBack}
              edge={colors.edgeSurface}
              travel={4}
              radius={radius.pill}
              intent="navigate"
              accessibilityLabel={t('common.goBack')}
              testID="back"
              style={[styles.back, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Ionicons name="chevron-back" size={22} color={colors.ink} />
            </PressKey>
          )}
          <View style={[styles.chip, { backgroundColor: wash.green, borderColor: washEdge.green }]}>
            <Text style={[type.caption, styles.chipText, { color: COMPANION_COLORS.sage.accentEdge }]}>
              {t('publicApply.forMentors')}
            </Text>
          </View>
        </View>

        {/* The stage and the scene have no arrival — they are simply already there. */}
        <View
          style={[styles.block, { width: block }]}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('landing.sceneA11y')}
        >
          <View style={[styles.abs, { left: (block - RING) / 2, top: -14 }]} pointerEvents="none">
            <Stage size={RING} rings={1} />
          </View>
          <View style={[styles.abs, { left: 50, right: 50, bottom: -8, alignItems: 'center' }]} pointerEvents="none">
            <GroundGlow width={block - 100} height={22} />
          </View>
          <View style={[styles.scene, { left: (block - SCENE_W) / 2 }]} pointerEvents="none">
            <Image
              source={SCENES.landingStill}
              resizeMode="contain"
              style={{
                position: 'absolute',
                width: sceneSide,
                height: sceneSide,
                left: (SCENE_W - sceneSide) / 2,
                top: SCENE_H - sceneSide * BAND.ground,
              }}
            />
          </View>
        </View>

        <View style={styles.stackTight}>
          <Entrance index={0}>
            <Text style={[type.displayHeadline, styles.headline, { color: colors.ink }]} accessibilityRole="header">
              {t('publicApply.headline')}
              <Text style={{ color: colors.accent }}>{t('publicApply.headlineAccent')}</Text>
            </Text>
          </Entrance>
          <Entrance index={1}>
            <Text style={[type.body, styles.sub, { color: colors.inkMuted }]}>{t('publicApply.sub')}</Text>
          </Entrance>
        </View>

        <Entrance index={2}>
          <EdgeSurface edge={colors.edgeSurface} style={[styles.rows, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            {ROWS.map((row) => (
              <View key={row.title} style={styles.row}>
                <IconBadge icon={row.icon} tone={row.tone} size={36} />
                <View style={styles.rowText}>
                  <Text style={[type.rowTitle, { color: colors.ink }]}>{t(row.title)}</Text>
                  <Text style={[type.note, { color: colors.inkMuted }]}>{t(row.body)}</Text>
                </View>
              </View>
            ))}
          </EdgeSurface>
        </Entrance>
      </ScrollView>

      {/* Sticky: a fade into the ground, the key, and the honest line(s). The host's
          SafeAreaView already applied the bottom inset. */}
      <View style={styles.footer} pointerEvents="box-none">
        <Svg width="100%" height={28} style={styles.fade} pointerEvents="none">
          <Defs>
            <LinearGradient id="applyFade" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.bg} stopOpacity={0} />
              <Stop offset="1" stopColor={colors.bg} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="28" fill="url(#applyFade)" />
        </Svg>
        <View style={[styles.footerBody, { backgroundColor: colors.bg, paddingBottom: 20 }]}>
          <Entrance index={3}>
            <PrimaryButton label={t('publicApply.cta')} shape="key" trailing="arrow" onPress={onApply} testID="apply-start" />
          </Entrance>
          <Text style={[type.caption, styles.center, { color: colors.inkMuted }]}>
            <Text style={{ color: colors.ink, fontFamily: type.label.fontFamily }}>{t('publicApply.peers')}</Text>
            {/* "No app needed" is the web page's promise; inside the app it would read oddly. */}
            {surface === 'public' ? `\n${t('publicApply.note')}` : null}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  intro: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: 12 },
  stackTight: { gap: space.sm },
  header: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  chip: { height: 28, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center' },
  chipText: { fontFamily: type.label.fontFamily },
  block: { height: BLOCK_H, alignSelf: 'center' },
  abs: { position: 'absolute' },
  scene: { position: 'absolute', bottom: 0, width: SCENE_W, height: SCENE_H },
  headline: { lineHeight: 36 },
  sub: { lineHeight: 22 },
  rows: { padding: 14, gap: 12, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  rowText: { flex: 1, minWidth: 0 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  fade: { marginBottom: -1 },
  footerBody: { paddingHorizontal: space.lg, gap: 10 },
  center: { textAlign: 'center' },
});

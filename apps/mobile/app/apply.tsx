import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { SCENES } from '@/assets/scenes';
import { ApplicationForm } from '@/components/ApplicationForm';
import { dobToISO, type Dob } from '@/components/DobPicker';
import { DobWheels } from '@/components/DobWheels';
import { EdgeSurface } from '@/components/EdgeSurface';
import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { LogoWordmark } from '@/components/art/Logo';
import { MentorPageHeader } from '@/components/mentor/MentorPageHeader';
import { AmbientBackground } from '@/components/motion/AmbientBackground';
import { Entrance } from '@/components/motion/Entrance';
import { GroundGlow } from '@/components/motion/GroundGlow';
import { Stage } from '@/components/motion/Stage';
import { ApiError, api } from '@/lib/api';
import { useI18n, type TKey } from '@/lib/i18n';
import { saveSession } from '@/lib/session';
import { useFrameSize } from '@/lib/useFrameSize';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS } from '@/theme/companion';
import { radius, space, type, wash, washEdge } from '@/theme/tokens';

const MIN_AGE = 18; // mirrors the server gate (server is the source of truth)
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

// Same DOB math as components/onboarding/steps/AgeStep.tsx, copied rather than
// imported — AgeStep is tangled into the onboarding step-machine/draft-persistence,
// which this standalone public page has no use for.
function ageFrom(dob: Dob, today = new Date()): number {
  let age = today.getFullYear() - dob.year;
  const m = today.getMonth() + 1 - dob.month;
  if (m < 0 || (m === 0 && today.getDate() < dob.day)) age -= 1;
  return age;
}

const ROWS: { icon: 'chatbubble-outline' | 'time-outline' | 'heart-outline'; tone: 'green' | 'orange' | 'indigo'; title: TKey; body: TKey }[] = [
  { icon: 'chatbubble-outline', tone: 'green', title: 'publicApply.row1Title', body: 'publicApply.row1Body' },
  { icon: 'time-outline', tone: 'orange', title: 'publicApply.row2Title', body: 'publicApply.row2Body' },
  { icon: 'heart-outline', tone: 'indigo', title: 'publicApply.row3Title', body: 'publicApply.row3Body' },
];

type Phase = 'intro' | 'age' | 'form' | 'done';

/** Public mentor-recruitment page (board A38, console.agentin.chat/apply) — web, no app,
 * no session. The landing's sky and its two-people scene on the round stage (no animals:
 * the companion belongs to members inside the app). "Apply to mentor" leads to the
 * server-side age gate (the first-run wheels) — it mints a throwaway anonymous member via
 * the unchanged onboarding/start — then the shared application form. */
export default function Apply() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { width } = useFrameSize();
  const today = new Date();
  const [phase, setPhase] = useState<Phase>('intro');
  const [dob, setDob] = useState<Dob>({ day: 1, month: 1, year: today.getFullYear() - MIN_AGE });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // Once the age gate has minted the throwaway session, going back and pressing Apply
  // again returns to the form — never a second anonymous member.
  const [sessionReady, setSessionReady] = useState(false);
  const insets = useSafeAreaInsets();

  const age = ageFrom(dob, today);
  const future = new Date(dob.year, dob.month - 1, dob.day) > today;
  const underAge = !future && age < MIN_AGE;
  const canContinue = !future && !underAge;
  const block = Math.min(342, width - space.lg * 2);
  const sceneSide = SCENE_W / BAND.width;

  const startApplying = async () => {
    if (!canContinue || starting) return;
    setStarting(true);
    setStartError(null);
    try {
      const result = await api.startOnboarding({ dob: dobToISO(dob) });
      await saveSession(result.session_token, result.stream_token, result.user);
      setSessionReady(true);
      setPhase('form');
    } catch (e) {
      setStartError(e instanceof ApiError ? e.message : t('mentorApply.error'));
    } finally {
      setStarting(false);
    }
  };

  if (phase !== 'intro') {
    return (
      <View style={[styles.root, { backgroundColor: colors.bg }]}>
        <AmbientBackground />
        <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <MentorPageHeader
              eyebrow={t('publicApply.forMentors')}
              title={t('mentorApply.title')}
              onBack={() => setPhase('intro')}
            />
            {phase === 'age' ? (
              <View style={styles.stack}>
                <Entrance index={0}>
                  <Text style={[type.displayHeadline, { color: colors.ink }]} accessibilityRole="header">
                    {t('publicApply.ageHeadline')}
                    <Text style={{ color: colors.accent }}>{t('publicApply.ageHeadlineAccent')}</Text>
                  </Text>
                </Entrance>
                <Entrance index={1}>
                  <Text style={[type.body, { color: colors.inkMuted }]}>{t('publicApply.ageSub')}</Text>
                </Entrance>
                <DobWheels value={dob} onChange={setDob} entranceFrom={2} />
                {/* A limit state is still: plain text, no motion, no haptic (T&S #11). */}
                {underAge ? (
                  <Text style={[type.caption, styles.center, { color: colors.danger }]}>
                    {t('onboarding.age.underAge', { age: MIN_AGE })}
                  </Text>
                ) : null}
                {future ? (
                  <Text style={[type.caption, styles.center, { color: colors.danger }]}>{t('onboarding.age.future')}</Text>
                ) : null}
                {startError ? <Text style={[type.note, styles.center, { color: colors.ink }]}>{startError}</Text> : null}
                <Entrance index={5}>
                  <PrimaryButton
                    label={t('common.continue')}
                    shape="key"
                    trailing="arrow"
                    onPress={() => void startApplying()}
                    disabled={!canContinue}
                    loading={starting}
                    testID="apply-dob-continue"
                  />
                </Entrance>
              </View>
            ) : phase === 'form' ? (
              <ApplicationForm onSuccess={() => setPhase('done')} />
            ) : (
              <Entrance index={0}>
                <EdgeSurface
                  edge={colors.edgeSurface}
                  style={[styles.done, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  testID="apply-success"
                >
                  <IconBadge icon="checkmark" tone="green" size={44} />
                  <Text style={[styles.doneHeadline, { color: colors.ink }]} accessibilityRole="header">
                    {t('publicApply.doneHeadline')}
                    <Text style={{ color: colors.accent }}>{t('publicApply.doneHeadlineAccent')}</Text>
                  </Text>
                  <Text style={[type.body, { color: colors.ink }]}>{t('publicApply.doneBody')}</Text>
                  <Text style={[type.caption, { color: colors.inkMuted }]}>{t('publicApply.peers')}</Text>
                </EdgeSurface>
              </Entrance>
            )}
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]} testID="apply-page">
      {/* The landing's own sky. */}
      <AmbientBackground />
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <ScrollView contentContainerStyle={[styles.intro, { paddingBottom: FOOTER_ROOM }]} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <LogoWordmark />
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

        {/* Sticky: a fade into the ground, the key, and the two honest lines. */}
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
          <View style={[styles.footerBody, { backgroundColor: colors.bg, paddingBottom: 20 + insets.bottom }]}>
            <Entrance index={3}>
              <PrimaryButton
                label={t('publicApply.cta')}
                shape="key"
                trailing="arrow"
                onPress={() => setPhase(sessionReady ? 'form' : 'age')}
                testID="apply-start"
              />
            </Entrance>
            <Text style={[type.caption, styles.center, { color: colors.inkMuted }]}>
              <Text style={{ color: colors.ink, fontFamily: type.label.fontFamily }}>{t('publicApply.peers')}</Text>
              {'\n'}
              {t('publicApply.note')}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  intro: { paddingHorizontal: space.lg, paddingTop: space.sm, gap: 12 },
  inner: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg, gap: 14 },
  stack: { gap: 14 },
  stackTight: { gap: space.sm },
  header: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
  done: { padding: 20, gap: space.sm, alignItems: 'flex-start', borderWidth: 1 },
  doneHeadline: { fontSize: 26, lineHeight: 34, fontFamily: type.displayHeadline.fontFamily },
  center: { textAlign: 'center' },
});

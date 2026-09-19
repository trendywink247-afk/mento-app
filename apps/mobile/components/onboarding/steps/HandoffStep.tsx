import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Ellipse } from 'react-native-svg';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Companion } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { Entrance } from '@/components/motion/Entrance';
import { GroundGlow } from '@/components/motion/GroundGlow';
import { Stage } from '@/components/motion/Stage';
import { useBreathing } from '@/components/motion/useBreathing';
import { StepScaffold } from '@/components/onboarding/StepScaffold';
import { capture } from '@/lib/analytics';
import { ApiError, api } from '@/lib/api';
import { useI18n, type TKey } from '@/lib/i18n';
import { clearDraft, getDraft } from '@/lib/onboardingDraft';
import { getSessionToken, saveSession } from '@/lib/session';
import { useFrameSize } from '@/lib/useFrameSize';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS } from '@/theme/companion';
import { handoff } from '@/theme/motion';
import { radius, space, type, wash } from '@/theme/tokens';

/** Board A34: a 292 stage, the companion 196 tall standing 52 above its bottom edge. */
const STAGE = 292;
const STAGE_MIN = 168;
/** Everything on the step that is not the stage (header, headline, line, strip, key). */
const REST = 580;

const STEPS: TKey[] = ['mentorHandoff.step1', 'mentorHandoff.step2', 'mentorHandoff.step3'];
/** Three paw prints walking in from the left (board: left / bottom / tilt / strength). */
const PAWS = [
  { left: -14, bottom: 22, tilt: '-18deg', opacity: 0.4 },
  { left: 26, bottom: 36, tilt: '-12deg', opacity: 0.5 },
  { left: 66, bottom: 46, tilt: '-6deg', opacity: 0.6 },
];

/** Mentor branch terminal step — board A34: the companion has walked onto a sage round
 * stage, "Thank you for wanting to be here for someone.", what happens next, and "Go to
 * Mentor Home". Behind it the step mints the anonymous session (no companion, NO match);
 * it onboards at most once — a session left by an earlier attempt is reused. When the
 * session exists the screen holds a readable beat and goes on by itself (board: "auto /
 * continue"); the key goes at once. Error state goes still (no shake), Retry only. */
export function HandoffStep({
  active,
  onInvalidDraft,
  onDone,
}: {
  active: boolean;
  onInvalidDraft: () => void;
  onDone: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const breathing = useBreathing();
  const { height } = useFrameSize();
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  // The key was pressed before the session existed: go the moment it does.
  const wantsGo = useRef(false);
  // Gates only the automatic mount-triggered run — the Retry button calls
  // run() directly on purpose, bypassing this latch.
  const startedRef = useRef(false);
  const doneRef = useRef(false);
  // Unmount guard: a late network resolution must never navigate or set state
  // on an instance the user has already backed out of.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const finish = useCallback(() => {
    if (doneRef.current || !mountedRef.current) return;
    doneRef.current = true;
    clearDraft();
    onDone();
  }, [onDone]);

  const run = useCallback(async () => {
    setError(null);
    const draft = getDraft();
    if (!draft.dob) {
      onInvalidDraft();
      return;
    }
    try {
      if (!(await getSessionToken())) {
        const onboarding = await api.startOnboarding({ dob: draft.dob, email: draft.email ?? null });
        await saveSession(onboarding.session_token, onboarding.stream_token, onboarding.user);
        capture('onboarding_completed');
      }
      if (!mountedRef.current) return;
      if (wantsGo.current) finish();
      else setReady(true);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof ApiError ? e.message : t('common.networkError'));
    }
  }, [onInvalidDraft, finish, t]);

  useEffect(() => {
    if (active && !startedRef.current) {
      startedRef.current = true;
      void run();
    }
  }, [active, run]);

  // "auto": a readable beat, then Mentor Home. Stepping back to the primer cancels it.
  useEffect(() => {
    if (!ready || !active) return;
    const timer = setTimeout(finish, handoff.hold);
    return () => clearTimeout(timer);
  }, [ready, active, finish]);

  const onGo = () => {
    if (ready) finish();
    else wantsGo.current = true;
  };

  const animal = (getDraft().companionAnimal as CompanionAnimal | null) ?? 'Owl';
  const stage = Math.max(STAGE_MIN, Math.min(STAGE, height - REST));
  const k = stage / STAGE;
  const sageInk = COMPANION_COLORS.sage.accentEdge;

  return (
    <StepScaffold
      footerIndex={error ? undefined : 6}
      footer={
        <>
          {error ? (
            <PrimaryButton label={t('connecting.tryAgain')} shape="key" onPress={() => void run()} testID="retry" />
          ) : (
            <PrimaryButton label={t('mentorHandoff.cta')} shape="key" trailing="arrow" onPress={onGo} testID="handoff-go" />
          )}
          <Text style={[type.caption, styles.footLine, { color: colors.inkMuted }]}>{t('mentorPrimer.footer')}</Text>
        </>
      }
    >
      <View testID="handoff" style={styles.root}>
        {/* The stage and the companion have no arrival: they are simply already there. */}
        <View style={[styles.stage, { width: stage, height: stage }]}>
          <Stage size={stage} rings={1} tone="sage" />
          <View style={[styles.glow, { left: 70 * k, bottom: 44 * k }]}>
            <GroundGlow width={stage - 140 * k} height={26 * k} />
          </View>
          {PAWS.map((paw, i) => (
            <Entrance key={paw.left} index={1 + i} style={[styles.paw, { left: paw.left * k, bottom: paw.bottom * k }]}>
              <Svg width={20} height={14} viewBox="0 0 20 14" style={{ transform: [{ rotate: paw.tilt }] }}>
                <Ellipse cx={5} cy={4} rx={4} ry={2.6} fill={sageInk} fillOpacity={paw.opacity} />
                <Ellipse cx={14} cy={10} rx={4} ry={2.6} fill={sageInk} fillOpacity={paw.opacity} />
              </Svg>
            </Entrance>
          ))}
          <View
            style={[styles.companion, { bottom: 52 * k }]}
            accessible
            accessibilityRole="image"
            accessibilityLabel={t('mentorHandoff.companionA11y')}
            pointerEvents="none"
          >
            <Animated.View style={[styles.originBottom, breathing]}>
              <Companion animal={animal} size={188 * k} pose={error ? undefined : 'greet'} awake />
            </Animated.View>
          </View>
          <Entrance index={3} style={[styles.chipWrap, { top: 34 * k }]}>
            <EdgeSurface
              edge={colors.edgeSurface}
              travel={3}
              radius={radius.pill}
              style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Ionicons name="ear-outline" size={14} color={sageInk} />
              <Text style={[type.caption, styles.chipText, { color: sageInk }]}>{t('mentorHandoff.chip')}</Text>
            </EdgeSurface>
          </Entrance>
        </View>

        <View style={styles.head}>
          <Entrance index={3}>
            <Text style={[type.displayHeadline, { color: colors.ink }]} accessibilityRole="header">
              {error ? t('mentorHandoff.errorHeadline') : t('mentorHandoff.headline')}
              {error ? null : <Text style={{ color: colors.accent }}>{t('mentorHandoff.headlineAccent')}</Text>}
            </Text>
          </Entrance>
          <Entrance index={4}>
            <Text style={[type.body, { color: colors.inkMuted }]}>{error ?? t('mentorHandoff.sub')}</Text>
          </Entrance>
        </View>

        {error ? null : (
          <Entrance index={5}>
            <View
              style={[styles.strip, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
              accessibilityRole="list"
              accessibilityLabel={t('mentorHandoff.stepsA11y')}
            >
              {STEPS.map((key, i) => (
                <View key={key} style={styles.stripItem}>
                  {i > 0 ? <View style={[styles.stripLink, { backgroundColor: colors.edgeAlt }]} /> : null}
                  <View style={[styles.num, { backgroundColor: i === 0 ? colors.accent : wash.green }]}>
                    <Text style={[type.label, styles.numText, { color: i === 0 ? colors.onAccent : sageInk }]}>{i + 1}</Text>
                  </View>
                  <Text style={[type.caption, styles.stripLabel, { color: colors.ink }]}>{t(key)}</Text>
                </View>
              ))}
            </View>
          </Entrance>
        )}

        <View style={styles.grow} />
      </View>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1 },
  stage: { alignSelf: 'center' },
  glow: { position: 'absolute' },
  paw: { position: 'absolute', width: 20, height: 14 },
  companion: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  originBottom: { transformOrigin: 'bottom' },
  chipWrap: { position: 'absolute', right: -4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 30,
    paddingLeft: 10,
    paddingRight: 12,
    borderWidth: 1,
  },
  chipText: { fontFamily: type.label.fontFamily },
  head: { marginTop: 14, gap: space.sm },
  strip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  stripItem: { flex: 1, minWidth: 0, alignItems: 'center', gap: 6 },
  // The short rule between two numbers sits on the seam, level with the discs' middle.
  stripLink: { position: 'absolute', left: -9, top: 13, width: 18, height: 2, borderRadius: radius.pill },
  num: { width: 28, height: 28, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  numText: { fontFamily: type.displayHeadline.fontFamily },
  stripLabel: { fontFamily: type.label.fontFamily, textAlign: 'center', paddingHorizontal: space.sm },
  grow: { flexGrow: 1, minHeight: space.sm },
  footLine: { textAlign: 'center', marginTop: space.sm },
});

import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { EdgeSurface } from '@/components/EdgeSurface';
import { CompanionPerches, CompanionSlot, useCompanionPlacement } from '@/components/art/PerchedCompanion';
import { JournalPageHeader } from '@/components/journal/JournalPageHeader';
import { DeepArrival } from '@/components/motion/DeepArrival';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { ApiError, api, type OrganizeResult } from '@/lib/api';
import type { PlacementSlot } from '@/lib/companionPlacement';
import { useI18n, type TKey } from '@/lib/i18n';
import { getThreadsConsent, setThreadsConsent } from '@/lib/journalConsent';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { COMPANION_COLORS } from '@/theme/companion';
import { duration, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, wash, washInk } from '@/theme/tokens';

/**
 * Find the threads (board A30) — the opt-in note-sorting helper (SCOPE §9). Beta, OFF by
 * default: nothing is sent anywhere until the member turns the consent switch on AND
 * presses the key. The switch is a device preference (lib/journalConsent.ts).
 *
 * What is read: the member's own writing channels only (mood notes + gratitude) — the
 * server refuses mentor notes and never sees chats (T&S #6/#7). The endpoint sorts one
 * channel per call, so the key asks for each and lays the themes out together.
 * Dark by default server-side: without a key the endpoint 503s and we say so, still.
 */
const CHANNELS = ['mood', 'gratitude'] as const;
const PERCHES: PlacementSlot[] = [{ id: 'threadsWaiting', type: 'top', level: 'low', home: true }];
const NO_PERCHES: PlacementSlot[] = [];

type Tone = 'indigo' | 'sky' | 'green';
type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'result'; themes: OrganizeResult['themes']; notes: number }
  | { kind: 'error'; message: TKey };

const SAMPLES: { icon: keyof typeof Ionicons.glyphMap; tone: Tone; title: TKey; count: number; line: TKey }[] = [
  { icon: 'time-outline', tone: 'indigo', title: 'journalPage.sample1Title', count: 4, line: 'journalPage.sample1Line' },
  { icon: 'moon-outline', tone: 'sky', title: 'journalPage.sample2Title', count: 3, line: 'journalPage.sample2Line' },
  { icon: 'leaf-outline', tone: 'green', title: 'journalPage.sample3Title', count: 2, line: 'journalPage.sample3Line' },
];
const TONE_INK: Record<Tone, string> = {
  indigo: COMPANION_COLORS.plum.accentEdge,
  sky: COMPANION_COLORS.sky.accentEdge,
  green: washInk.green,
};
const TONES: Tone[] = ['indigo', 'sky', 'green'];
const THEME_ICONS: (keyof typeof Ionicons.glyphMap)[] = ['time-outline', 'moon-outline', 'leaf-outline'];
const THREAD_MARKS = [
  'M8 58c22-16 36 14 58-2',
  'M276 40c20-14 34 12 56-4',
  'M14 168c18-12 30 10 48-2',
  'M284 150c16-12 30 10 46-2',
];
const KNOB_TRAVEL = 20;

function Knob({ on }: { on: boolean }) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const x = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    x.value = reduced ? (on ? 1 : 0) : withTiming(on ? 1 : 0, { duration: duration.fast, easing: easing.settle });
  }, [on, reduced, x]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: KNOB_TRAVEL * x.value }] }));
  return (
    <View style={[styles.track, { backgroundColor: on ? colors.accent : colors.inkMuted }]}>
      <Animated.View style={[styles.knob, { backgroundColor: colors.surface }, slide]} />
    </View>
  );
}

function ThreadCard({
  icon,
  tone,
  title,
  count,
  line,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: Tone;
  title: string;
  count: string | null;
  line: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <EdgeSurface
      edge={colors.edgeSurface}
      travel={4}
      radius={radius.lg}
      testID={testID}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={[styles.cardIcon, { backgroundColor: wash[tone] }]}>
        <Ionicons name={icon} size={20} color={TONE_INK[tone]} />
      </View>
      <View style={styles.cardText}>
        <View style={styles.cardHead}>
          <Text style={[type.rowTitle, styles.cardTitle, { color: colors.ink }]} numberOfLines={2}>
            {title}
          </Text>
          {count ? <Text style={[type.caption, { color: colors.inkMuted }]}>{count}</Text> : null}
        </View>
        <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={3}>
          {line}
        </Text>
      </View>
    </EdgeSurface>
  );
}

export default function FindTheThreadsScreen() {
  useSessionGuard();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const [on, setOn] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  // The big waiting companion belongs to the OFF state only; an honest notice is still.
  const perch = useCompanionPlacement('journalThreads', on ? NO_PERCHES : PERCHES, {
    still: phase.kind === 'error',
  });

  useEffect(() => {
    let live = true;
    void getThreadsConsent().then((v) => {
      if (live) setOn(v);
    });
    return () => {
      live = false;
    };
  }, []);

  const toggle = () => {
    const next = !on;
    setOn(next);
    setPhase({ kind: 'idle' });
    void setThreadsConsent(next);
  };

  const find = async () => {
    if (!on || phase.kind === 'loading') return;
    setPhase({ kind: 'loading' });
    const answers = await Promise.allSettled(CHANNELS.map((c) => api.organizeNotes(c)));
    const good = answers.flatMap((a) => (a.status === 'fulfilled' ? [a.value] : []));
    if (good.length > 0) {
      setPhase({
        kind: 'result',
        themes: good.flatMap((g) => g.themes),
        notes: good.reduce((n, g) => n + g.entry_count, 0),
      });
      return;
    }
    const statuses = answers.map((a) => (a.status === 'rejected' && a.reason instanceof ApiError ? a.reason.status : 0));
    setPhase({
      kind: 'error',
      message: statuses.includes(503)
        ? 'journals.organizeDisabled'
        : statuses.every((s) => s === 400)
          ? 'journals.organizeEmpty'
          : 'journals.organizeError',
    });
  };

  const found = phase.kind === 'result';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <CompanionPerches placement={perch}>
        <View style={styles.page}>
          <JournalPageHeader
            onBack={() => router.back()}
            backLabel={t('journalPage.backA11y')}
            title={t('journals.hubTitle')}
          />

          <DeepArrival style={styles.fill}>
            <ScrollView style={styles.fill} showsVerticalScrollIndicator={false} contentContainerStyle={styles.column}>
              <Entrance index={1} style={styles.intro}>
                <View style={styles.titleRow}>
                  <Text style={[type.displayHeadline, styles.title, { color: colors.ink }]} accessibilityRole="header">
                    {t('journalPage.threadsLead')}
                    <Text style={{ color: colors.accent }}>{t('journalPage.threadsAccent')}</Text>
                  </Text>
                  <View style={[styles.beta, { backgroundColor: wash.orange }]}>
                    <Text style={[styles.betaText, { color: washInk.orange }]}>{t('journals.beta')}</Text>
                  </View>
                </View>
                <Text style={[type.bodySmall, styles.para, { color: colors.ink }]}>{t('journalPage.threadsWhat')}</Text>
                <Text style={[type.bodySmall, styles.para, { color: colors.inkMuted }]}>{t('journalPage.threadsSkip')}</Text>
              </Entrance>

              <Entrance index={2}>
                <PressKey
                  onPress={toggle}
                  edge={colors.edgeSurface}
                  radius={radius.lg}
                  intent="toggle"
                  accessibilityRole="switch"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={t('journalPage.consentTitle')}
                  accessibilityHint={t('journalPage.consentSub')}
                  testID="threads-consent"
                  style={[styles.consent, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <View style={[styles.cardIcon, { backgroundColor: wash.indigo }]}>
                    <Ionicons name="sparkles-outline" size={20} color={TONE_INK.indigo} />
                  </View>
                  <View style={styles.cardText}>
                    <Text style={[styles.consentTitle, { color: colors.ink }]}>{t('journalPage.consentTitle')}</Text>
                    <Text style={[type.caption, { color: colors.inkMuted }]}>{t('journalPage.consentSub')}</Text>
                  </View>
                  <View style={styles.switchCol}>
                    <Knob on={on} />
                    <Text
                      style={[styles.switchWord, { color: on ? colors.accent : colors.inkMuted }]}
                      testID="threads-consent-state"
                    >
                      {on ? t('journalPage.on') : t('journalPage.off')}
                    </Text>
                  </View>
                </PressKey>
              </Entrance>

              {on ? (
                <View style={styles.onBlock}>
                  <Entrance>
                    <PressKey
                      onPress={() => void find()}
                      edge={colors.accentEdge}
                      radius={radius.md}
                      intent="commit"
                      disabled={phase.kind === 'loading'}
                      accessibilityLabel={found ? t('journalPage.lookAgain') : t('journals.threads')}
                      testID="threads-find"
                      style={[styles.find, { backgroundColor: colors.accent }]}
                    >
                      {phase.kind === 'loading' ? (
                        <ActivityIndicator color={colors.onAccent} />
                      ) : (
                        <Ionicons name="git-merge-outline" size={20} color={colors.onAccent} />
                      )}
                      <Text style={[type.key, { color: colors.onAccent }]}>
                        {phase.kind === 'loading'
                          ? t('journals.organizeBusy')
                          : found
                            ? t('journalPage.lookAgain')
                            : t('journals.threads')}
                      </Text>
                    </PressKey>
                  </Entrance>

                  {phase.kind === 'error' ? (
                    // Still on purpose (T&S #11): a limit / not-ready note never animates.
                    <View
                      style={[styles.notice, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                      testID="organize-error"
                    >
                      <Ionicons name="information-circle-outline" size={18} color={colors.inkMuted} />
                      <Text style={[type.note, styles.cardText, { color: colors.ink }]}>{t(phase.message)}</Text>
                    </View>
                  ) : null}

                  {found ? (
                    <Entrance key="found-head" style={styles.resultHead}>
                      <Text style={[styles.resultTitle, { color: colors.ink }]}>{t('journalPage.yourThreads')}</Text>
                      <Text style={[type.caption, { color: colors.inkMuted }]}>
                        {t('journalPage.fromNotes', { count: phase.notes })}
                      </Text>
                    </Entrance>
                  ) : (
                    <Entrance index={1} style={styles.sampleHead}>
                      <View style={[styles.sampleChip, { backgroundColor: colors.bgLavender }]}>
                        <Text style={[type.chip, { color: colors.inkMuted }]}>{t('journalPage.sample')}</Text>
                      </View>
                      <Text style={[type.label, styles.cardText, { color: colors.ink }]}>{t('journalPage.sampleTitle')}</Text>
                    </Entrance>
                  )}

                  <View style={styles.cards} testID={found ? 'organize-result' : 'threads-sample'}>
                    <View pointerEvents="none" style={[styles.threadLine, { borderColor: colors.accentTintEdge }]} />
                    {found
                      ? phase.themes.map((th, i) => (
                          <Entrance key={`${th.title}-${i}`} index={Math.min(i, 4) + 1}>
                            <ThreadCard
                              icon={THEME_ICONS[i % THEME_ICONS.length]}
                              tone={TONES[i % TONES.length]}
                              title={th.title}
                              count={th.count ? t('journalPage.noteCount', { count: th.count }) : null}
                              line={th.summary}
                              testID={`thread-${i}`}
                            />
                          </Entrance>
                        ))
                      : SAMPLES.map((s, i) => (
                          <Entrance key={s.title} index={i + 2}>
                            <ThreadCard
                              icon={s.icon}
                              tone={s.tone}
                              title={t(s.title)}
                              count={t('journalPage.noteCount', { count: s.count })}
                              line={t(s.line)}
                            />
                          </Entrance>
                        ))}
                  </View>
                </View>
              ) : (
                <Entrance index={3} style={styles.offBlock}>
                  <View style={styles.ground}>
                    <View style={[styles.disc, { backgroundColor: colors.bgLavender }]} />
                    <View style={[styles.shadow, { backgroundColor: colors.edgeSurface }]} />
                    <View style={StyleSheet.absoluteFill} pointerEvents="none">
                      <Svg width="100%" height={230} viewBox="0 0 342 230" preserveAspectRatio="xMidYMid meet">
                        {THREAD_MARKS.map((d) => (
                          <Path key={d} d={d} stroke={colors.accentTintEdge} strokeWidth={1.75} strokeLinecap="round" fill="none" />
                        ))}
                      </Svg>
                    </View>
                    <View style={styles.waiting}>
                      <CompanionSlot id="threadsWaiting" flow size={160} />
                    </View>
                  </View>
                  <View style={styles.offText}>
                    <Text style={[styles.offTitle, { color: colors.ink }]} testID="threads-off">
                      {t('journalPage.offTitle')}
                    </Text>
                    <Text style={[type.note, styles.center, { color: colors.inkMuted }]}>{t('journalPage.offBody')}</Text>
                  </View>
                </Entrance>
              )}
            </ScrollView>
          </DeepArrival>
        </View>
      </CompanionPerches>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  fill: { flex: 1, minHeight: 0 },
  page: { flex: 1, paddingTop: space.xs, paddingHorizontal: space.lg, gap: 12 },
  column: { flexGrow: 1, gap: 14, paddingBottom: space.lg },
  intro: { gap: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  title: { lineHeight: 36 },
  beta: { height: 24, paddingHorizontal: 10, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  betaText: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16 },
  para: { lineHeight: 22 },
  consent: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1 },
  consentTitle: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 22 },
  switchCol: { alignItems: 'center', gap: 2 },
  switchWord: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 14 },
  track: { width: 52, height: 32, borderRadius: radius.pill },
  knob: { position: 'absolute', left: 3, top: 3, width: 26, height: 26, borderRadius: radius.pill },
  onBlock: { gap: 12 },
  find: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: 12, borderRadius: radius.md, borderWidth: 1 },
  sampleHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.xs },
  sampleChip: { height: 20, paddingHorizontal: space.sm, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  resultHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, paddingHorizontal: space.xs, flexWrap: 'wrap' },
  resultTitle: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 24 },
  cards: { gap: 10 },
  threadLine: { position: 'absolute', left: 31, top: 16, bottom: 16, width: 0, borderLeftWidth: 2, borderStyle: 'dashed' },
  card: { paddingVertical: 12, paddingLeft: 12, paddingRight: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1 },
  cardIcon: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  cardText: { flex: 1, minWidth: 0 },
  cardHead: { flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' },
  cardTitle: { flexShrink: 1 },
  offBlock: { flexGrow: 1, justifyContent: 'flex-end', gap: 12 },
  ground: { height: 230, alignItems: 'center' },
  disc: { position: 'absolute', top: 10, width: 212, height: 212, borderRadius: radius.pill },
  // An ellipse: a circle flattened (a static transform, not an animation).
  shadow: { position: 'absolute', bottom: -72, width: 200, height: 200, borderRadius: radius.pill, transform: [{ scaleY: 0.2 }] },
  waiting: { position: 'absolute', bottom: 22, alignItems: 'center' },
  offText: { gap: 4, alignItems: 'center' },
  offTitle: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 22, textAlign: 'center' },
  center: { textAlign: 'center' },
});

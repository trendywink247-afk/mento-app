import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EdgeSurface } from '@/components/EdgeSurface';
import { CompanionPerches, CompanionSlot, useCompanionPlacement } from '@/components/art/PerchedCompanion';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { FeedbackPill } from '@/components/path/FeedbackPill';
import { StageSheen } from '@/components/path/ambient';
import { api, type PathState } from '@/lib/api';
import type { PlacementSlot } from '@/lib/companionPlacement';
import { useI18n } from '@/lib/i18n';
import { screenCache } from '@/lib/screenCache';
import { COMPANION_COLORS } from '@/theme/companion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, wash } from '@/theme/tokens';

/**
 * Path (Communities) — board A07, "home built around your stage". A LENS on the core loop
 * (the member's community and stage, tuned starters, seasonal support, the way to a mentor) —
 * never a feed. Everything on it is server-driven (`GET /paths/me`); nothing moves client-side.
 *
 *   - "Change" and the invitation's key open the Pathfinder (app/pathfinder.tsx, a deeper page);
 *   - a starter, and "Ask a mentor", open the first-question builder — nothing is matched or
 *     sent from this screen;
 *   - "Browse" opens the mentors page.
 */
/** Where the companion can be (lib/companionPlacement.ts). Two states, two lists — a slot only
 * counts while its furniture is on screen. Home on the Path home is where the board draws it:
 * perched on the stage panel, beside the community name. */
const INVITE_PERCHES: PlacementSlot[] = [
  { id: 'inviteHero', type: 'top', level: 'high', home: true },
  { id: 'inviteCta', type: 'lean', level: 'mid' },
  { id: 'tabBarLeft', type: 'top', level: 'low' },
  { id: 'tabBarNap', type: 'nap', level: 'low' },
  { id: 'inviteCtaDangle', type: 'dangle', level: 'mid' },
  { id: 'tabBarPeek', type: 'peek', level: 'low' },
];
const HOME_PERCHES: PlacementSlot[] = [
  { id: 'stageTop', type: 'top', level: 'high', home: true },
  { id: 'talkCorner', type: 'lean', level: 'mid' },
];
const SEASONAL_PERCHES: PlacementSlot[] = [
  { id: 'seasonalTop', type: 'top', level: 'high' },
  { id: 'seasonalNap', type: 'nap', level: 'high' },
  { id: 'seasonalDangle', type: 'dangle', level: 'high' },
];
const NO_PERCHES: PlacementSlot[] = [];

export default function PathTab() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  // Start from what was last on screen and refresh quietly on focus (lib/screenCache.ts);
  // the spinner is for the very first load only. A failed refresh keeps what is showing.
  const cachedPath = screenCache.get('path');
  const [loading, setLoading] = useState(!cachedPath);
  const [state, setState] = useState<PathState | null>(cachedPath ?? null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      // Coming back from the Pathfinder: what it saved is already in the cache, so the new
      // stage is on screen before the refresh lands.
      const fresh = screenCache.get('path');
      if (fresh) setState(fresh);
      void api
        .myPath()
        .then((s) => {
          if (!active) return;
          screenCache.set('path', s);
          setState(s);
        })
        .catch(() => {})
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  const openPathfinder = () => router.push('/pathfinder');

  const onHome = Boolean(state?.community && state.stage);
  const perches = loading
    ? NO_PERCHES
    : !onHome
      ? INVITE_PERCHES
      : state?.seasonal
        ? [...HOME_PERCHES, ...SEASONAL_PERCHES]
        : HOME_PERCHES;
  const perch = useCompanionPlacement('path', perches);

  if (loading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top']}>
        <View style={styles.center} testID="path-loading">
          <ActivityIndicator color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  const header = (
    <Entrance index={1} style={styles.head}>
      <Text style={[type.pageTitle, styles.title, { color: colors.ink }]} accessibilityRole="header">
        {t('pathHome.titleLead')}
        <Text style={{ color: colors.accent }}>{t('pathHome.titleAccent')}</Text>
      </Text>
      <FeedbackPill testID="path-feedback" />
    </Entrance>
  );

  // --- No path yet: the invitation ---
  if (!state?.community || !state.stage) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top']}>
        <CompanionPerches placement={perch}>
          <View style={styles.inviteTop}>{header}</View>
          <View style={styles.center}>
            <Entrance index={2}>
              <View style={styles.hero}>
                <CompanionSlot id="inviteHero" flow size={96} />
                <Text style={[type.sheetTitle, styles.centerText, { color: colors.ink }]}>{t('path.inviteTitle')}</Text>
                <Text style={[type.body, styles.centerText, { color: colors.inkMuted }]}>{t('path.inviteBody')}</Text>
              </View>
            </Entrance>
            <Entrance index={3} style={styles.inviteCta}>
              <CompanionSlot id="inviteCta" size={48} inset={space.sm} />
              <CompanionSlot id="inviteCtaDangle" size={56} inset={space.sm} />
              <PressKey
                onPress={openPathfinder}
                edge={colors.accentEdge}
                radius={radius.md}
                testID="path-start"
                style={[styles.bigKey, { backgroundColor: colors.accent }]}
              >
                <Text style={[type.key, { color: colors.onAccent }]}>{t('path.findCta')}</Text>
                <Ionicons name="arrow-forward" size={20} color={colors.onAccent} />
              </PressKey>
            </Entrance>
          </View>
          {/* The tab bar's top edge is this screen's floor. */}
          <View style={styles.floor} pointerEvents="none">
            <CompanionSlot id="tabBarLeft" size={56} align="left" inset={space.lg} attach="floor" />
            <CompanionSlot id="tabBarNap" size={56} align="left" inset={space.lg} attach="floor" />
            <CompanionSlot id="tabBarPeek" size={46} align="left" inset={space.xl} attach="floor" />
          </View>
        </CompanionPerches>
      </SafeAreaView>
    );
  }

  // --- Path home ---
  const { community, stage } = state;
  const lens = `${community.name} · ${stage.title}`;
  const openBuilder = (starter?: string) =>
    // The first-question builder (DECISIONS §L.8): the starter is shaped there and handed to
    // the chat composer — nothing is matched or sent on this tap.
    router.push({
      pathname: '/path-question',
      params: { ...(starter ? { starter } : {}), community: community.slug, lens },
    });

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top']}>
      <CompanionPerches placement={perch}>
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
          {header}

          <Entrance index={2} style={styles.lift}>
            <EdgeSurface
              edge={colors.edgeSurface}
              travel={3}
              radius={radius.lg}
              style={[styles.stageCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              {/* The companion's home is beside the community name; the room is only kept
                  while it is actually standing there (it roams between arrivals). */}
              <View style={[styles.stageTop, perch.slotId === 'stageTop' ? styles.stageTopRoom : null]}>
                <View style={styles.stageNames}>
                  <Text style={[styles.eyebrow, { color: colors.inkMuted }]}>{t('pathHome.yourCommunity')}</Text>
                  <Text style={[styles.community, { color: colors.ink }]} numberOfLines={1} testID="path-community">
                    {community.name}
                  </Text>
                </View>
                <PressKey
                  onPress={openPathfinder}
                  edge={colors.edgeAlt}
                  travel={3}
                  radius={radius.pill}
                  accessibilityLabel={t('pathHome.changeA11y')}
                  testID="path-change"
                  style={[styles.change, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                >
                  <Ionicons name="swap-horizontal-outline" size={16} color={colors.ink} />
                  <Text style={[type.label, { color: colors.ink }]}>{t('pathHome.change')}</Text>
                </PressKey>
              </View>
              <View>
                <CompanionSlot id="stageTop" size={64} align="left" inset={4} nudge={8} />
                <View style={[styles.stagePanel, { backgroundColor: colors.accentTint }]}>
                  <StageSheen />
                  <Text style={[styles.stageTitle, { color: colors.ink }]} testID="path-stage">
                    {stage.title}
                  </Text>
                  <Text style={[type.note, { color: colors.ink }]}>{stage.blurb}</Text>
                </View>
              </View>
            </EdgeSurface>
          </Entrance>

          {state.seasonal ? (
            <Entrance index={3} style={styles.lift}>
              <CompanionSlot id="seasonalTop" size={56} inset={space.md} />
              <CompanionSlot id="seasonalNap" size={56} inset={space.md} />
              <CompanionSlot id="seasonalDangle" size={60} inset={space.md} />
              <EdgeSurface
                edge={colors.edgeAlt}
                travel={3}
                radius={radius.lg}
                style={[styles.seasonal, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                testID="path-seasonal"
              >
                <View style={[styles.seasonalIcon, { backgroundColor: wash.indigo }]}>
                  <Ionicons name="calendar-outline" size={20} color={COMPANION_COLORS.plum.accentEdge} />
                </View>
                <View style={styles.seasonalText}>
                  <Text style={[styles.cardTitle, { color: colors.ink }]}>{state.seasonal.title}</Text>
                  <Text style={[type.caption, { color: colors.inkMuted }]}>{state.seasonal.body}</Text>
                </View>
              </EdgeSurface>
            </Entrance>
          ) : null}

          {state.prompts.length > 0 ? (
            <Entrance index={4} style={styles.prompts}>
              <Text style={[styles.section, { color: colors.ink }]}>{t('path.promptsTitle')}</Text>
              {state.prompts.map((p, i) => (
                <PressKey
                  key={p}
                  onPress={() => openBuilder(p)}
                  edge={colors.edgeSurface}
                  radius={radius.md}
                  testID={`path-prompt-${i}`}
                  style={[styles.prompt, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <Text style={[styles.promptText, { color: colors.ink }]}>{p}</Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
                </PressKey>
              ))}
            </Entrance>
          ) : null}

          <Entrance index={5} style={styles.lift}>
            <CompanionSlot id="talkCorner" size={48} inset={space.md} />
            <EdgeSurface
              edge={colors.edgeSurface}
              travel={3}
              radius={radius.lg}
              style={[styles.talkCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View>
                <Text style={[styles.talkTitle, { color: colors.ink }]}>{t('path.talkTitle')}</Text>
                <View style={styles.talkLine}>
                  <Ionicons name="time-outline" size={14} color={colors.inkMuted} />
                  <Text style={[type.caption, { color: colors.inkMuted }]} testID="path-mentors-line">
                    {state.listeners_online > 0
                      ? t(state.listeners_online === 1 ? 'path.listenersOne' : 'path.listenersOther', {
                          count: state.listeners_online,
                        })
                      : t('path.listenersNone')}
                  </Text>
                </View>
              </View>
              <View style={styles.talkRow}>
                <PressKey
                  onPress={() => openBuilder()}
                  edge={colors.accentEdge}
                  radius={radius.md}
                  testID="path-talk"
                  containerStyle={styles.askBox}
                  style={[styles.talkKey, { backgroundColor: colors.accent }]}
                >
                  <Text style={[type.keyDense, { color: colors.onAccent }]} numberOfLines={1}>
                    {t('path.talkNow')}
                  </Text>
                  <Ionicons name="arrow-forward" size={18} color={colors.onAccent} />
                </PressKey>
                <PressKey
                  onPress={() => router.push('/mentors')}
                  edge={colors.edgeAlt}
                  radius={radius.md}
                  testID="path-browse"
                  containerStyle={styles.browseBox}
                  style={[styles.talkKey, styles.bordered, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                >
                  <Text style={[type.keyDense, { color: colors.ink }]} numberOfLines={1}>
                    {t('path.browse')}
                  </Text>
                </PressKey>
              </View>
            </EdgeSurface>
          </Entrance>
        </ScrollView>
      </CompanionPerches>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingHorizontal: space.lg },
  centerText: { textAlign: 'center' },
  content: { paddingTop: space.xs, paddingHorizontal: space.md, paddingBottom: space.lg, gap: space.sm },
  head: {
    minHeight: 44,
    paddingHorizontal: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: { lineHeight: 34, flexShrink: 1 },
  inviteTop: { paddingTop: space.xs, paddingHorizontal: space.md },
  hero: { alignItems: 'center', gap: space.sm },
  inviteCta: { alignSelf: 'stretch' },
  bigKey: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  floor: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 0 },
  lift: { zIndex: 2 },
  stageCard: { padding: 12, gap: space.sm, borderWidth: 1 },
  stageTop: { minHeight: 44, paddingLeft: space.xs, flexDirection: 'row', alignItems: 'center', gap: 10 },
  stageTopRoom: { paddingLeft: 70 },
  stageNames: { flex: 1, minWidth: 0 },
  eyebrow: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16, letterSpacing: 0.5, textTransform: 'uppercase' },
  community: { fontFamily: font.sansHeavy, fontSize: 22, lineHeight: 26 },
  change: { height: 44, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1 },
  stagePanel: { overflow: 'hidden', paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.md },
  stageTitle: { fontFamily: font.sansHeavy, fontSize: 18, lineHeight: 24 },
  seasonal: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  seasonalIcon: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  seasonalText: { flex: 1, minWidth: 0 },
  cardTitle: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 22 },
  prompts: { gap: 10 },
  section: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 20, paddingTop: 2, paddingHorizontal: space.sm },
  prompt: {
    minHeight: 44,
    paddingVertical: space.sm,
    paddingLeft: 14,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
  },
  promptText: { flex: 1, fontFamily: font.sansSemi, fontSize: 15, lineHeight: 20 },
  talkCard: { paddingVertical: 10, paddingHorizontal: 14, gap: 6, borderWidth: 1 },
  talkTitle: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 22 },
  talkLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  talkRow: { flexDirection: 'row', gap: 12 },
  askBox: { flex: 1.3 },
  browseBox: { flex: 1 },
  talkKey: { height: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  bordered: { borderWidth: 1 },
});

import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { Screen } from '@/components/Screen';
import { Companion } from '@/components/art/Companion';
import { CompanionPerches, CompanionSlot, useCompanionPlacement } from '@/components/art/PerchedCompanion';
import { Entrance } from '@/components/motion/Entrance';
import { Tilt3D } from '@/components/motion/Tilt3D';
import { TiltCard } from '@/components/motion/TiltCard';
import { capture } from '@/lib/analytics';
import { ApiError, api, type PathNode, type PathState, type PathTree } from '@/lib/api';
import type { PlacementSlot } from '@/lib/companionPlacement';
import { useI18n } from '@/lib/i18n';
import { screenCache } from '@/lib/screenCache';
import { getCompanionAnimal } from '@/lib/session';
import type { CompanionAnimal } from '@/components/art/Companions';
import type { CompanionTrigger } from '@/components/art/Companion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/**
 * Path (Communities) — SCOPE spec docs/superpowers/specs/2026-07-13-path-communities.md.
 * The Pathfinder (companion-led questions) is the door into a community; the Path home
 * is a LENS on the core loop (tuned prompts, seasonal support, same-road listeners) —
 * never a feed. Anonymity rails untouched.
 */
/** Where the companion can be (lib/companionPlacement.ts). Two states, two lists — a slot only
 * counts while its furniture is on screen. The places it ALREADY had are the home slots: the
 * hero above the invitation, and the right of the Path home heading (that column stays
 * reserved, so the ground above the seasonal card is always clear). The Pathfinder question
 * walk keeps its own staged hero, like onboarding. */
const INVITE_PERCHES: PlacementSlot[] = [
  { id: 'inviteHero', type: 'top', level: 'high', home: true },
  { id: 'inviteCta', type: 'lean', level: 'mid' },
  { id: 'tabBarLeft', type: 'top', level: 'low' },
  { id: 'tabBarNap', type: 'nap', level: 'low' },
  { id: 'inviteCtaDangle', type: 'dangle', level: 'mid' },
  { id: 'tabBarPeek', type: 'peek', level: 'low' },
];
const HOME_PERCHES: PlacementSlot[] = [
  { id: 'headRight', type: 'top', level: 'high', home: true },
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
  const [state, setStateRaw] = useState<PathState | null>(cachedPath ?? null);
  const setState = useCallback((s: PathState) => {
    screenCache.set('path', s);
    setStateRaw(s);
  }, []);
  const [tree, setTree] = useState<PathTree | null>(null);
  const [nodeId, setNodeId] = useState<string | null>(null); // non-null = pathfinder running
  const [animal, setAnimal] = useState<CompanionAnimal | null>(null);
  const [joy, setJoy] = useState<CompanionTrigger>(null);
  const [note, setNote] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void api
        .myPath()
        .then((s) => {
          if (active) setState(s);
        })
        .catch(() => {})
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [setState]),
  );

  useEffect(() => {
    void getCompanionAnimal().then((a) => setAnimal(a as CompanionAnimal | null));
  }, []);

  const startPathfinder = async () => {
    setNote(null);
    try {
      const t = tree ?? (await api.pathTree());
      setTree(t);
      setNodeId(t.root);
    } catch {
      setNote(t('path.loadError'));
    }
  };

  const pick = async (opt: { next?: string; community?: string; stage?: string }) => {
    if (opt.next) {
      setNodeId(opt.next);
      return;
    }
    if (!opt.community || !opt.stage) return;
    try {
      const s = await api.choosePath(opt.community, opt.stage);
      // Community only — the journey stage stays off analytics (coarse is coarse).
      capture('path_chosen', { community: opt.community });
      setState(s);
      setNodeId(null);
      // A path chosen is a small win — the companion wiggles, doesn't hop.
      setJoy((t) => ({ kind: 'joy', n: (t?.n ?? 0) + 1 }));
    } catch {
      setNote(t('path.saveError'));
    }
  };

  const talk = async () => {
    if (matching) return;
    setMatching(true);
    setNote(null);
    try {
      const match = await api.match({ kind: 'general' });
      router.push({
        pathname: '/chat/[id]',
        params: {
          id: match.conversation_id,
          listener: match.listener_persona_name,
          channel: match.stream_channel_id ?? '',
        },
      });
    } catch (e) {
      setNote(
        e instanceof ApiError && e.status === 503
          ? t('common.allBusy')
          : t('path.connectError'),
      );
    } finally {
      setMatching(false);
    }
  };

  const onHome = Boolean(state?.community && state.stage);
  const perches =
    loading || (nodeId && tree)
      ? NO_PERCHES
      : !onHome
        ? INVITE_PERCHES
        : state?.seasonal
          ? [...HOME_PERCHES, ...SEASONAL_PERCHES]
          : HOME_PERCHES;
  // A failed load / save / match is a still state: the home slot, sitting (T&S #11).
  const perch = useCompanionPlacement('path', perches, { still: note !== null });

  if (loading) {
    return (
      <Screen>
        <View style={styles.center} testID="path-loading">
          <ActivityIndicator color={colors.accent} />
        </View>
      </Screen>
    );
  }

  // --- Pathfinder (question walk) ---
  if (nodeId && tree) {
    const node: PathNode = tree.nodes[nodeId];
    return (
      <Screen scroll>
        <Entrance index={0}>
          <View style={styles.hero}>
            <Tilt3D maxTilt={6}>
              <Companion animal={animal} size={72} />
            </Tilt3D>
            <Text style={[styles.heroTitle, { color: colors.ink }]} accessibilityRole="header">
              {node.question}
            </Text>
            <Text style={[type.caption, styles.centerText, { color: colors.inkMuted }]}>
              {t('path.hint')}
            </Text>
          </View>
        </Entrance>
        {node.options.map((opt, i) => (
          <Entrance key={opt.label} index={1 + i}>
            <TiltCard
              style={[styles.optionCard, { backgroundColor: colors.surface }]}
              containerStyle={styles.cardSpacing}
              edge={colors.edgeSurface}
              onPress={() => void pick(opt)}
              testID={`path-option-${i}`}
            >
              {opt.icon ? (
                // reason: icon names come from server config, validated visually not by type
                <Ionicons name={opt.icon as any} size={20} color={colors.accent} />
              ) : (
                <Ionicons name="ellipse-outline" size={20} color={colors.accentSoft} />
              )}
              <Text style={[styles.optionLabel, { color: colors.ink }]}>{opt.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.inkMuted} />
            </TiltCard>
          </Entrance>
        ))}
        {note ? <Text style={[type.caption, styles.note, { color: colors.inkMuted }]}>{note}</Text> : null}
      </Screen>
    );
  }

  // --- No path yet: the invitation ---
  if (!state?.community || !state.stage) {
    return (
      <Screen>
        <CompanionPerches placement={perch}>
        <View style={styles.center}>
          <Entrance index={0}>
            <View style={styles.hero}>
              <CompanionSlot id="inviteHero" flow size={96} />
              <Text style={[styles.heroTitle, { color: colors.ink }]} accessibilityRole="header">
                {t('path.inviteTitle')}
              </Text>
              <Text style={[type.body, styles.centerText, { color: colors.inkMuted }]}>
                {t('path.inviteBody')}
              </Text>
            </View>
          </Entrance>
          <Entrance index={1}>
            <View>
              <CompanionSlot id="inviteCta" size={48} inset={space.sm} />
              <CompanionSlot id="inviteCtaDangle" size={56} inset={space.sm} />
              <Pressable
                style={[styles.cta, { backgroundColor: colors.accent }]}
                onPress={() => void startPathfinder()}
                accessibilityRole="button"
                testID="path-start"
              >
                <Text style={styles.ctaLabel}>{t('path.findCta')}</Text>
              </Pressable>
            </View>
          </Entrance>
          {note ? <Text style={[type.caption, styles.note, { color: colors.inkMuted }]}>{note}</Text> : null}
        </View>
        {/* The tab bar's top edge is this screen's floor. */}
        <View style={styles.floor} pointerEvents="none">
          <CompanionSlot id="tabBarLeft" size={56} align="left" inset={space.lg} attach="floor" />
          <CompanionSlot id="tabBarNap" size={56} align="left" inset={space.lg} attach="floor" />
          <CompanionSlot id="tabBarPeek" size={46} align="left" inset={space.xl} attach="floor" />
        </View>
        </CompanionPerches>
      </Screen>
    );
  }

  // --- Path home ---
  const { community, stage } = state;
  return (
    <Screen scroll>
      <CompanionPerches placement={perch}>
      <Entrance index={0}>
        <View style={styles.homeHead}>
          <View style={{ flex: 1 }}>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{t('path.yourPath')}</Text>
            <Text style={[styles.homeTitle, { color: colors.ink }]} accessibilityRole="header">
              {community.name} · {stage.title}
            </Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{stage.blurb}</Text>
          </View>
          <CompanionSlot id="headRight" flow reserve size={56} trigger={joy} />
        </View>
      </Entrance>

      {state.seasonal ? (
        <Entrance index={1}>
          <View style={styles.seasonalWrap}>
          <CompanionSlot id="seasonalTop" size={56} />
          <CompanionSlot id="seasonalNap" size={56} />
          <CompanionSlot id="seasonalDangle" size={60} />
          <View style={[styles.seasonal, { backgroundColor: colors.accentTint }]}>
            <Ionicons name="sparkles-outline" size={18} color={colors.accent} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.ink }]}>{state.seasonal.title}</Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>{state.seasonal.body}</Text>
            </View>
          </View>
          </View>
        </Entrance>
      ) : null}

      <Entrance index={2}>
        <Text style={[styles.section, { color: colors.ink }]}>{t('path.promptsTitle')}</Text>
        <Text style={[type.caption, { color: colors.inkMuted, marginBottom: space.sm }]}>
          {t('path.promptsSub')}
        </Text>
        {state.prompts.map((p, i) => (
          <TiltCard
            key={p}
            style={[styles.promptCard, { backgroundColor: colors.surface }]}
            edge={colors.edgeSurface}
            onPress={() =>
              // The first-question builder (DECISIONS §L.8): the starter is shaped there and
              // handed to the chat composer — nothing is matched or sent on this tap.
              router.push({
                pathname: '/path-question',
                params: { starter: p, community: community.slug, lens: `${community.name} · ${stage.title}` },
              })
            }
            disabled={matching}
            testID={`path-prompt-${i}`}
          >
            <Text style={[styles.promptText, { color: colors.ink }]}>"{p}"</Text>
            <Ionicons name="arrow-forward-circle" size={22} color={colors.accent} />
          </TiltCard>
        ))}
      </Entrance>

      <Entrance index={3}>
        <View style={styles.talkWrap}>
        <EdgeSurface
          edge={colors.edgeSurface}
          style={[styles.talkCard, { backgroundColor: colors.surface }]}
        >
          {/* The heading block keeps its right corner free — the companion can stand there. */}
          <View style={styles.talkHead}>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>
              {t('path.talkTitle')}
            </Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              {state.listeners_online > 0
                ? t(state.listeners_online === 1 ? 'path.listenersOne' : 'path.listenersOther', {
                    count: state.listeners_online,
                  })
                : t('path.listenersNone')}
            </Text>
            <CompanionSlot id="talkCorner" size={48} attach="floor" />
          </View>
          <View style={styles.talkRow}>
            <Pressable
              style={[styles.cta, { backgroundColor: colors.accent, flex: 1 }]}
              onPress={() => void talk()}
              disabled={matching}
              accessibilityRole="button"
              testID="path-talk"
            >
              {matching ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.ctaLabel}>{t('path.talkNow')}</Text>
              )}
            </Pressable>
            <Pressable
              style={[styles.ghost, { borderColor: colors.border }]}
              onPress={() => router.push('/(tabs)/mentors')}
              accessibilityRole="button"
              testID="path-browse"
            >
              <Text style={[styles.ghostLabel, { color: colors.accent }]}>{t('path.browse')}</Text>
            </Pressable>
          </View>
        </EdgeSurface>
        </View>
      </Entrance>

      {note ? <Text style={[type.caption, styles.note, { color: colors.inkMuted }]}>{note}</Text> : null}

      <Entrance index={4}>
        <Pressable
          style={styles.change}
          onPress={() => void startPathfinder()}
          accessibilityRole="button"
          testID="path-change"
        >
          <Ionicons name="swap-horizontal-outline" size={14} color={colors.inkMuted} />
          <Text style={[type.caption, { color: colors.inkMuted }]}>{t('path.change')}</Text>
        </Pressable>
      </Entrance>
      </CompanionPerches>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  centerText: { textAlign: 'center' },
  hero: { alignItems: 'center', gap: space.sm, marginTop: space.md, marginBottom: space.lg },
  heroTitle: {
    fontFamily: font.sansHeavy,
    fontSize: 24,
    lineHeight: 32,
    textAlign: 'center',
    marginTop: space.xs,
  },
  cardSpacing: { marginBottom: space.sm },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.lg,
    padding: space.md,
  },
  optionLabel: { flex: 1, fontFamily: font.sansSemi, fontSize: 15, lineHeight: 21 },
  cta: {
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: space.xl,
    alignItems: 'center',
  },
  ctaLabel: { color: '#fff', fontFamily: font.sansBold, fontSize: 16 },
  ghost: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: space.lg,
    alignItems: 'center',
  },
  ghostLabel: { fontFamily: font.sansBold, fontSize: 15 },
  homeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.sm,
    marginBottom: space.md,
  },
  homeTitle: { fontFamily: font.sansHeavy, fontSize: 21, lineHeight: 28 },
  seasonalWrap: { marginBottom: space.md, zIndex: 1 },
  seasonal: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    borderRadius: radius.lg,
    padding: space.md,
  },
  cardTitle: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 21 },
  section: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 24, marginTop: space.sm },
  promptCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.md,
  },
  promptText: { flex: 1, fontFamily: font.sansSemi, fontSize: 14, lineHeight: 20 },
  talkWrap: { marginTop: space.md, zIndex: 1 },
  talkCard: { borderRadius: radius.lg, padding: space.md, gap: space.xs },
  talkHead: { gap: space.xs, paddingRight: 56, minHeight: 44 },
  floor: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 0 },
  talkRow: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  note: { textAlign: 'center', marginTop: space.sm },
  change: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginVertical: space.lg,
  },
});

/**
 * Pathfinder (board A26, "life first, then exams") — a deeper page reached from the Path
 * tab's "Change" key (or its first invitation). One page instead of a question walk: the
 * routes, then where on that route, then "Use this path".
 *
 * NOTHING about the content lives here: every question, route, segment and moment is read off
 * the server's tree (`GET /paths/tree`), and the choice is saved with `PUT /paths/me`. The
 * page only arranges the tree the way the board draws it:
 *   - the root's LEAF options (a community + stage each — today, the three Life moments) are
 *     grouped by community into one route row, listed first ("life first");
 *   - each BRANCH option of the root is a route row (today: the exam branch). Its node's own
 *     branches become the segmented control (UPSC · NEET · JEE · …), and the chosen
 *     segment's leaves become the moments;
 *   - "I'm not sure yet" chooses nothing: it leaves without a lens, which the matcher treats
 *     exactly like any other member (community is a soft preference).
 * A route the server does not serve (the board also draws "Work and career") is not invented.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackKey } from '@/components/DeepHeader';
import { EdgeSurface } from '@/components/EdgeSurface';
import { GroundFade } from '@/components/GroundFade';
import { CompanionPerches, CompanionSlot, useCompanionPlacement } from '@/components/art/PerchedCompanion';
import { DeepArrival } from '@/components/motion/DeepArrival';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { SkyBlob, useAccentWash } from '@/components/path/ambient';
import { capture } from '@/lib/analytics';
import { api, type PathOption, type PathTree } from '@/lib/api';
import { cachedPathTree, communityLabel } from '@/lib/communityLabel';
import type { PlacementSlot } from '@/lib/companionPlacement';
import { useI18n } from '@/lib/i18n';
import { screenCache } from '@/lib/screenCache';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { COMPANION_COLORS } from '@/theme/companion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, wash, washInk, type Wash } from '@/theme/tokens';

const PERCHES: PlacementSlot[] = [{ id: 'firstChoice', type: 'top', level: 'high', home: true }];
const UNSURE = '__unsure';

type Leaf = PathOption & { community: string; stage: string };
type RouteRow =
  | { key: string; kind: 'group'; community: string; leaves: Leaf[] }
  | { key: string; kind: 'branch'; option: PathOption; next: string }
  | { key: typeof UNSURE; kind: 'unsure' };

const isLeaf = (o: PathOption): o is Leaf => Boolean(o.community && o.stage);

/** Icon discs cycle through the washes; each wash has its own ink (≥ 4.5:1 on it). */
const DISC: { wash: Wash; ink: string }[] = [
  { wash: 'green', ink: washInk.green },
  { wash: 'orange', ink: washInk.orange },
  { wash: 'sky', ink: COMPANION_COLORS.sky.accentEdge },
];
const UNSURE_DISC = { wash: 'indigo' as Wash, ink: COMPANION_COLORS.plum.accentEdge };

export default function Pathfinder() {
  useSessionGuard();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const accentWash = useAccentWash();

  const [tree, setTree] = useState<PathTree | null>(null);
  const [failed, setFailed] = useState(false);
  const [routeKey, setRouteKey] = useState<string | null>(null);
  const [segment, setSegment] = useState<string | null>(null); // node id of the chosen segment
  const [moment, setMoment] = useState<Leaf | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // A failed load or save is a still state: the companion sits, nothing moves (T&S #11).
  const perch = useCompanionPlacement('pathfinder', PERCHES, { still: failed || note !== null });

  const routes: RouteRow[] = useMemo(() => {
    if (!tree) return [];
    const root = tree.nodes[tree.root];
    const groups = new Map<string, Leaf[]>();
    const branches: RouteRow[] = [];
    for (const o of root?.options ?? []) {
      if (isLeaf(o)) groups.set(o.community, [...(groups.get(o.community) ?? []), o]);
      else if (o.next && tree.nodes[o.next]) branches.push({ key: o.next, kind: 'branch', option: o, next: o.next });
    }
    const grouped: RouteRow[] = [...groups.entries()].map(([community, leaves]) => ({
      key: `c-${community}`,
      kind: 'group',
      community,
      leaves,
    }));
    return [...grouped, ...branches, { key: UNSURE, kind: 'unsure' }];
  }, [tree]);

  useEffect(() => {
    let active = true;
    // Changing a path opens on the one the member already has (from the Path tab's last
    // load; a deep link straight here asks the server once).
    void Promise.all([cachedPathTree(), screenCache.get('path') ?? api.myPath().catch(() => null)])
      .then(([loaded, mine]) => {
        if (!active) return;
        setTree(loaded);
        if (mine && !screenCache.get('path')) screenCache.set('path', mine);
        if (!mine?.community || !mine.stage) return;
        const want = (o: PathOption) => o.community === mine.community?.slug && o.stage === mine.stage?.id;
        for (const o of loaded.nodes[loaded.root]?.options ?? []) {
          if (isLeaf(o) && want(o)) {
            setRouteKey(`c-${o.community}`);
            setMoment(o);
            return;
          }
          const child = o.next ? loaded.nodes[o.next] : undefined;
          if (!child || !o.next) continue;
          const direct = child.options.find((x) => isLeaf(x) && want(x));
          if (direct && isLeaf(direct)) {
            setRouteKey(o.next);
            setMoment(direct);
            return;
          }
          for (const seg of child.options) {
            const hit = seg.next ? tree_find(loaded, seg.next, want) : undefined;
            if (hit && seg.next) {
              setRouteKey(o.next);
              setSegment(seg.next);
              setMoment(hit);
              return;
            }
          }
        }
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const route = routes.find((r) => r.key === routeKey) ?? null;
  const branchNode = route?.kind === 'branch' && tree ? tree.nodes[route.next] : null;
  const segments = (branchNode?.options ?? []).filter((o) => o.next && tree?.nodes[o.next]);
  const segmentNode = segment && tree ? tree.nodes[segment] : null;
  const segmentLabel = segments.find((s) => s.next === segment)?.label ?? null;
  const moments: Leaf[] =
    route?.kind === 'group'
      ? route.leaves
      : segmentNode
        ? segmentNode.options.filter(isLeaf)
        : (branchNode?.options ?? []).filter(isLeaf);

  const stepLabel =
    route?.kind === 'group'
      ? t('pathfinder.stepClosest', { name: communityLabel(tree, route.community) })
      : route?.kind === 'unsure'
        ? t('pathfinder.stepUnsure')
        : segmentNode && segmentLabel
          ? `${segmentLabel} · ${segmentNode.question}`
          : (branchNode?.question ?? '');

  const pickRoute = (key: string) => {
    if (saving) return;
    setNote(null);
    setRouteKey(key);
    setSegment(null);
    setMoment(null);
  };

  const canUse = route?.kind === 'unsure' || moment !== null;
  const use = async () => {
    if (!canUse || saving) return;
    setSaving(true);
    setNote(null);
    try {
      if (!moment) {
        // "Not sure yet" = no lens. For a member who has one this is how it is cleared
        // ("You can clear it anytime" must be true); otherwise there is nothing to save.
        if (screenCache.get('path')?.community) {
          await api.leavePath();
          screenCache.set('path', await api.myPath());
        }
        router.back();
        return;
      }
      const s = await api.choosePath(moment.community, moment.stage);
      // Community only — the journey stage stays off analytics (coarse is coarse).
      capture('path_chosen', { community: moment.community });
      screenCache.set('path', s); // the Path tab paints this the moment it is back in focus
      router.back();
    } catch {
      setNote(t('path.saveError'));
      setSaving(false);
    }
  };

  // The board's own headline (A26). The server tree's root question ("What brings you here
  // these days?") still leads the onboarding-side walk; this page asks it the board's way.
  const question = tree ? t('pathfinder.headline') : '';
  const disc = (i: number) => DISC[i % DISC.length];

  const renderRoute = (r: RouteRow, i: number) => {
    const on = r.key === routeKey;
    const look = r.kind === 'unsure' ? UNSURE_DISC : disc(i);
    const childLabels =
      r.kind === 'branch' ? (tree?.nodes[r.next]?.options ?? []).map((o) => o.label).join(' · ') : '';
    const title =
      r.kind === 'group'
        ? r.community === 'life'
          ? t('pathfinder.routeLife')
          : communityLabel(tree, r.community)
        : r.kind === 'branch'
          ? // reason: the board's wording for the exam route; any other branch keeps the tree's label
            r.next === 'q_exam'
            ? t('pathfinder.routeExam')
            : r.option.label
          : t('pathfinder.routeUnsure');
    const sub =
      r.kind === 'group'
        ? r.community === 'life'
          ? t('pathfinder.routeLifeSub')
          : ''
        : r.kind === 'branch'
          ? childLabels
          : t('pathfinder.routeUnsureSub');
    const icon =
      r.kind === 'group' ? 'leaf-outline' : r.kind === 'unsure' ? 'compass-outline' : (r.option.icon ?? 'book-outline');

    const row = (
      <PressKey
        onPress={() => pickRoute(r.key)}
        edge={on ? colors.accentTintEdge : colors.edgeSurface}
        radius={radius.lg}
        intent="select"
        accessibilityRole="radio"
        accessibilityState={{ selected: on }}
        testID={`pathfinder-route-${r.kind === 'group' ? r.community : r.kind === 'unsure' ? 'unsure' : i}`}
        style={[
          styles.route,
          on
            ? { backgroundColor: accentWash, borderColor: colors.accent, borderWidth: 2, paddingHorizontal: 13 }
            : { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <View style={[styles.routeDisc, { backgroundColor: wash[look.wash] }]}>
          {/* reason: branch icon names come from server config, validated visually not by type */}
          <Ionicons name={icon as any} size={22} color={look.ink} />
        </View>
        <View style={styles.routeText}>
          <Text style={[styles.routeTitle, { color: colors.ink }]}>{title}</Text>
          {sub ? (
            <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={2}>
              {sub}
            </Text>
          ) : null}
        </View>
        <View
          style={[
            styles.radio,
            on
              ? { backgroundColor: colors.accent, borderColor: colors.accent }
              : { backgroundColor: colors.surface, borderColor: colors.dotIdle },
          ]}
        >
          {on ? <Ionicons name="checkmark" size={13} color={colors.onAccent} /> : null}
        </View>
      </PressKey>
    );
    return (
      <Entrance key={r.key} index={Math.min(i + 2, 5)} style={i === 0 ? styles.lift : undefined}>
        {i === 0 ? <CompanionSlot id="firstChoice" size={56} inset={14} nudge={6} /> : null}
        {row}
      </Entrance>
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <SkyBlob />
      <CompanionPerches placement={perch}>
        <View style={styles.top}>
          <BackKey onPress={() => router.back()} label={t('pathQuestion.backA11y')} testID="pathfinder-back" />
          <DeepArrival style={styles.topText}>
            <Text style={[styles.lens, { color: colors.inkMuted }]} numberOfLines={1}>
              {t('path.yourPath')}
            </Text>
            <Text style={[styles.topTitle, { color: colors.ink }]} numberOfLines={1}>
              {t('pathfinder.title')}
            </Text>
          </DeepArrival>
        </View>

        {!tree ? (
          <View style={styles.center} testID={failed ? 'pathfinder-error' : 'pathfinder-loading'}>
            {failed ? (
              <Text style={[type.note, styles.centerText, { color: colors.ink }]}>{t('path.loadError')}</Text>
            ) : (
              <ActivityIndicator color={colors.accent} />
            )}
          </View>
        ) : (
          <DeepArrival style={styles.fill}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
              <Entrance index={1} style={styles.headline}>
                <Text style={[type.sheetTitle, styles.h1, { color: colors.ink }]} accessibilityRole="header">
                  {question}
                </Text>
                <Text style={[type.note, { color: colors.inkMuted }]}>{t('path.hint')}</Text>
              </Entrance>

              <View style={styles.routes} accessibilityRole="radiogroup" accessibilityLabel={t('pathfinder.routesA11y')}>
                {routes.map(renderRoute)}
              </View>

              {route ? (
                <View style={styles.step} testID="pathfinder-step">
                  <Text style={[type.label, styles.stepLabel, { color: colors.ink }]}>{stepLabel}</Text>

                  {segments.length > 0 ? (
                    <View
                      style={[styles.segments, { backgroundColor: colors.bgLavender, borderColor: colors.border }]}
                      accessibilityRole="radiogroup"
                    >
                      {segments.map((s, i) => {
                        const on = s.next === segment;
                        return (
                          <PressKey
                            key={s.label}
                            onPress={() => {
                              if (saving) return;
                              setSegment(s.next ?? null);
                              setMoment(null);
                            }}
                            edge={on ? colors.edgeAlt : 'transparent'}
                            travel={2}
                            radius={radius.sm}
                            intent="select"
                            accessibilityRole="radio"
                            accessibilityState={{ selected: on }}
                            testID={`pathfinder-seg-${i}`}
                            containerStyle={styles.segBox}
                            style={[
                              styles.seg,
                              on
                                ? { backgroundColor: colors.surface, borderColor: colors.border }
                                : { borderColor: 'transparent' },
                            ]}
                          >
                            <Text
                              style={[styles.segText, { color: on ? colors.accentEdge : colors.inkMuted }]}
                              numberOfLines={2}
                            >
                              {s.label}
                            </Text>
                          </PressKey>
                        );
                      })}
                    </View>
                  ) : null}

                  {moments.length > 0 ? (
                    <View style={styles.moments}>
                      {moments.map((m) => {
                        const on = moment?.community === m.community && moment.stage === m.stage;
                        return (
                          <View key={`${m.community}-${m.stage}`} style={styles.momentCell}>
                            <PressKey
                              onPress={() => {
                                if (saving) return;
                                setNote(null);
                                setMoment(on ? null : m);
                              }}
                              edge={on ? colors.accentTintEdge : colors.edgeSurface}
                              radius={radius.md}
                              intent="select"
                              accessibilityState={{ selected: on }}
                              testID={`pathfinder-moment-${m.community}-${m.stage}`}
                              style={[
                                styles.moment,
                                on
                                  ? { backgroundColor: colors.accentTint, borderColor: colors.accent, borderWidth: 2, paddingHorizontal: 11 }
                                  : { backgroundColor: colors.surface, borderColor: colors.border },
                              ]}
                            >
                              <Text style={[styles.momentText, { color: on ? colors.accentEdge : colors.ink }]}>
                                {m.label}
                              </Text>
                            </PressKey>
                          </View>
                        );
                      })}
                    </View>
                  ) : null}

                  {route.kind === 'unsure' ? (
                    <EdgeSurface
                      edge={colors.edgeAlt}
                      travel={3}
                      radius={radius.lg}
                      style={[styles.unsure, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                    >
                      <Text style={[styles.unsureTitle, { color: colors.ink }]}>{t('pathfinder.unsureTitle')}</Text>
                      <Text style={[type.note, { color: colors.inkMuted }]}>{t('pathfinder.unsureBody')}</Text>
                    </EdgeSurface>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>

            <View style={styles.footer}>
              <GroundFade height={FOOTER_FADE} />
              <Entrance index={6} style={styles.footerInner}>
                {note ? (
                  // Still on purpose: a failed save does not arrive, shake or buzz.
                  <Text style={[type.caption, styles.centerText, { color: colors.ink }]} testID="pathfinder-note">
                    {note}
                  </Text>
                ) : (
                  <Text style={[type.caption, styles.centerText, { color: colors.inkMuted }]}>
                    {t('pathfinder.onlyTunes')}
                  </Text>
                )}
                <View style={styles.keys}>
                  <PressKey
                    onPress={() => router.back()}
                    edge={colors.edgeSurface}
                    radius={radius.md}
                    disabled={saving}
                    testID="pathfinder-not-now"
                    containerStyle={styles.notNowBox}
                    style={[styles.key, styles.bordered, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  >
                    <Text style={[type.keyDense, { color: colors.ink }]} numberOfLines={1}>
                      {t('pathfinder.notNow')}
                    </Text>
                  </PressKey>
                  <PressKey
                    onPress={() => void use()}
                    edge={colors.accentEdge}
                    radius={radius.md}
                    intent="commit"
                    disabled={!canUse || saving}
                    testID="pathfinder-use"
                    containerStyle={styles.useBox}
                    style={[styles.key, { backgroundColor: colors.accent }]}
                  >
                    {saving ? (
                      <ActivityIndicator size="small" color={colors.onAccent} />
                    ) : (
                      <>
                        <Text style={[styles.useText, { color: colors.onAccent }]} numberOfLines={1}>
                          {t('pathfinder.use')}
                        </Text>
                        <Ionicons name="arrow-forward" size={20} color={colors.onAccent} />
                      </>
                    )}
                  </PressKey>
                </View>
              </Entrance>
            </View>
          </DeepArrival>
        )}
      </CompanionPerches>
    </SafeAreaView>
  );
}

/** The leaf under `nodeId` that matches, if any (one level — the tree's stage nodes). */
function tree_find(tree: PathTree, nodeId: string, want: (o: PathOption) => boolean): Leaf | undefined {
  const hit = tree.nodes[nodeId]?.options.find((o) => isLeaf(o) && want(o));
  return hit && isLeaf(hit) ? hit : undefined;
}

const GUTTER = space.md + space.xs; // 20 — the board's side margin on deeper pages
// Tall enough to sit under the whole footer when the note wraps to two lines (Hindi at 360).
const FOOTER_FADE = 190;

const styles = StyleSheet.create({
  safe: { flex: 1 },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  centerText: { textAlign: 'center' },
  top: { minHeight: 50, paddingTop: space.xs, paddingHorizontal: GUTTER, flexDirection: 'row', alignItems: 'center', gap: 12 },
  topText: { flex: 1, minWidth: 0 },
  lens: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  topTitle: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 24 },
  content: { paddingHorizontal: GUTTER, paddingTop: space.sm, paddingBottom: FOOTER_FADE + space.md, gap: 10 },
  headline: { paddingRight: 76, gap: 2 },
  h1: { lineHeight: 30 },
  routes: { gap: space.sm },
  lift: { zIndex: 2 },
  route: {
    minHeight: 60,
    paddingVertical: 7,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
  },
  routeDisc: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  routeText: { flex: 1, minWidth: 0 },
  routeTitle: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 20 },
  radio: { width: 22, height: 22, borderRadius: radius.pill, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  step: { gap: 6 },
  stepLabel: { lineHeight: 18, paddingHorizontal: space.xs },
  segments: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: radius.md, borderWidth: 1 },
  segBox: { flex: 1, minWidth: 0 },
  seg: { height: 44, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  segText: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 14, textAlign: 'center' },
  moments: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, rowGap: 4 },
  momentCell: { width: '50%', paddingHorizontal: 4 },
  moment: { minHeight: 48, paddingVertical: 6, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1 },
  momentText: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 17 },
  unsure: { paddingVertical: 14, paddingHorizontal: space.md, gap: 2, borderWidth: 1 },
  unsureTitle: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 22 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  footerInner: { paddingHorizontal: GUTTER, paddingTop: space.lg, paddingBottom: space.lg, gap: 10 },
  keys: { flexDirection: 'row', gap: 12 },
  notNowBox: { flex: 1 },
  useBox: { flex: 1.5 },
  key: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  bordered: { borderWidth: 1 },
  useText: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 24 },
});

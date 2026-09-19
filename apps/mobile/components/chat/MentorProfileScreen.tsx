import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackKey } from '@/components/DeepHeader';
import { EdgeSurface } from '@/components/EdgeSurface';
import { InTouchBadge, LinkedRings } from '@/components/InTouchBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Companion } from '@/components/art/Companion';
import { MentorFace, MentorFaceFigure } from '@/components/art/MentorFace';
import { DeepArrival } from '@/components/motion/DeepArrival';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { useBreathing } from '@/components/motion/useBreathing';
import { capture } from '@/lib/analytics';
import { ApiError, api, type ConversationMentor, type PathTree, type StayInTouch, type StayInTouchBlock } from '@/lib/api';
import { cachedPathTree, communityLabel } from '@/lib/communityLabel';
import { useI18n } from '@/lib/i18n';
import { pendingOption } from '@/lib/pendingOption';
import { useCompanionAnimal } from '@/lib/useCompanionAnimal';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { COMPANION_COLORS } from '@/theme/companion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, wash } from '@/theme/tokens';

/**
 * Mentor profile + stay in touch (board A14) — pushed from the chat header, keyed by the
 * CONVERSATION id (the server derives the mentor from it; no listener id travels through
 * route params). The persona name from params renders at once;
 * `GET /conversations/{id}/mentor` fills in the rest, including the member's stay-in-touch
 * standing (`stay_in_touch`).
 *
 * The one-sided favourite is gone (DECISIONS §L.6): continuity is a consented link. One tap
 * asks (`POST …/stay-in-touch`), "Take it back" / "End" is the DELETE. Every refusal
 * (`in_touch_full`, `in_touch_waiting`, `not_now_cooldown`, `mentor_unavailable`) is a calm,
 * STILL note — nothing on it animates, and none of them ever mentions money (T&S #4).
 */
type Block = StayInTouchBlock | 'too_many';

function blockFromCode(code: string | null): Block | null {
  if (code === 'in_touch_full' || code === 'in_touch_waiting' || code === 'not_now_cooldown') return code;
  if (code === 'mentor_unavailable' || code === 'unavailable') return 'unavailable';
  return null;
}

export default function MentorProfileScreen() {
  useSessionGuard();
  const router = useRouter();
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const animal = useCompanionAnimal();
  const mentorBreath = useBreathing(true);
  const { id: conversationId, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const fallbackName = name ?? t('chat.yourListener');

  const [profile, setProfile] = useState<ConversationMentor | null>(null);
  const [stay, setStay] = useState<StayInTouch | null>(null);
  const [tree, setTree] = useState<PathTree | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** A refusal that arrived on the tap itself (a race with another device, the hourly limit). */
  const [refused, setRefused] = useState<{ block: Block; until: string | null } | null>(null);
  const viewedRef = useRef(false);

  const load = useCallback(() => {
    if (!conversationId) return;
    setError(null);
    void api
      .mentorProfile(conversationId)
      .then(async (p) => {
        setProfile(p);
        // Older servers do not embed the standing: read it on its own.
        setStay(p.stay_in_touch ?? (await api.stayInTouch(conversationId).catch(() => null)));
      })
      .catch(() => setError(t('common.networkError')));
  }, [conversationId, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Community labels are a nice-to-have polish, never a blocker — fetched once,
  // best-effort, and simply ignored on failure (falls back to a title-cased slug).
  useEffect(() => {
    void cachedPathTree().then(setTree).catch(() => {});
  }, []);

  useEffect(() => {
    if (!viewedRef.current) {
      viewedRef.current = true;
      capture('mentor_profile_viewed');
    }
  }, []);

  const change = (call: (id: string) => Promise<StayInTouch>) => {
    if (!conversationId || busy) return;
    setBusy(true);
    setRefused(null);
    void call(conversationId)
      .then(setStay)
      .catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 409) {
          const until = typeof e.body?.can_ask_again_at === 'string' ? e.body.can_ask_again_at : null;
          setRefused({ block: blockFromCode(e.code) ?? 'unavailable', until });
        } else if (e instanceof ApiError && e.status === 429) {
          setRefused({ block: 'too_many', until: null });
        } else {
          setError(t('common.networkError'));
        }
      })
      .finally(() => setBusy(false));
  };

  const reportOrBlock = () => {
    pendingOption.set(conversationId ?? '', 'report');
    router.back();
  };

  const displayName = stay?.mentor_name ?? profile?.persona_name ?? fallbackName;
  const online = profile?.status === 'online';
  const firstMetAs = stay?.first_met_as ?? profile?.first_met_as ?? null;
  const slots = stay?.slots ?? null;
  const state = stay?.state ?? 'none';

  const standing: Block | null =
    stay && !stay.can_ask && state !== 'asked' && state !== 'in_touch'
      ? (stay.blocked_reason ?? (state === 'not_now' ? 'not_now_cooldown' : null))
      : null;
  const block: Block | null = refused?.block ?? standing;
  const until = refused?.until ?? stay?.can_ask_again_at ?? null;
  const blockText = (() => {
    if (!block) return null;
    if (block === 'in_touch_full') return t('inTouch.blockedFull');
    if (block === 'in_touch_waiting') return t('inTouch.blockedWaiting');
    if (block === 'too_many') return t('inTouch.tooMany');
    if (block === 'unavailable') return t('inTouch.blockedUnavailable');
    if (!until) return t('inTouch.blockedCooldownPlain');
    const date = new Date(until).toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
      day: 'numeric',
      month: 'long',
    });
    return t('inTouch.blockedCooldown', { date });
  })();

  const statusLine = [
    online ? t('mentorProfile.online') : t('mentorProfile.away'),
    profile?.community_slug ? t('inTouch.community', { name: communityLabel(tree, profile.community_slug) }) : null,
    !online && profile?.availability_note ? t('mentorProfile.usually', { note: profile.availability_note }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const slotsText = slots
    ? slots.waiting > 0
      ? t('inTouch.placesAsked', { waiting: slots.waiting, inTouch: slots.in_touch })
      : t('inTouch.placesFree', { free: slots.free, limit: slots.limit })
    : null;
  const face = { animal: profile?.companion_animal, colour: profile?.companion_colour };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.page} showsVerticalScrollIndicator={false}>
        <BackKey onPress={() => router.back()} label={t('inTouch.backA11y')} />

        <DeepArrival style={styles.column}>
          {/* Two in the room: the mentor's figure and, beside it, the member's companion —
              both standing on the top edge of the card. They are simply there. */}
          <View style={styles.hero}>
            <View style={styles.figures} pointerEvents="none">
              {profile ? (
                <Animated.View style={[styles.mentorFigure, mentorBreath]}>
                  <MentorFaceFigure animal={face.animal} width={96} height={110} />
                </Animated.View>
              ) : null}
              {animal ? (
                <View style={styles.memberFigure}>
                  <Companion animal={animal} size={84} awake />
                </View>
              ) : null}
            </View>
            <Entrance index={1}>
              <EdgeSurface
                edge={colors.edgeSurface}
                travel={3}
                radius={radius.lg}
                style={[styles.heroCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Text style={[styles.name, { color: colors.ink }]} accessibilityRole="header" testID="mentor-profile-name">
                  {displayName}
                </Text>
                <View style={styles.statusRow}>
                  {profile ? (
                    <View style={[styles.statusDot, { backgroundColor: online ? colors.success : colors.dotIdle }]} />
                  ) : null}
                  <Text style={[type.note, styles.statusText, { color: colors.inkMuted }]}>
                    {profile ? statusLine : t('chat.opening')}
                  </Text>
                </View>
                {profile?.public_line ? (
                  <Text style={[type.body, styles.publicLine, { color: colors.ink }]} testID="public-line">
                    {profile.public_line}
                  </Text>
                ) : null}
                <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentorProfile.pledge')}</Text>
              </EdgeSurface>
            </Entrance>
          </View>

          <Entrance index={2}>
            <View style={[styles.explain, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <View style={[styles.explainIcon, { backgroundColor: wash.indigo }]}>
                <Ionicons name="refresh-outline" size={20} color={COMPANION_COLORS.plum.accentEdge} />
              </View>
              <View style={styles.explainText}>
                <Text style={[type.keyDense, styles.explainTitle, { color: colors.ink }]}>{t('inTouch.namesTitle')}</Text>
                <Text style={[type.note, { color: colors.inkMuted }]}>{t('inTouch.namesBody')}</Text>
              </View>
            </View>
          </Entrance>

          {profile && stay ? (
            <Entrance index={3}>
              <EdgeSurface
                edge={colors.edgeSurface}
                travel={3}
                radius={radius.lg}
                style={[styles.preview, { backgroundColor: colors.surface, borderColor: colors.border }]}
                testID="in-touch-preview"
              >
                <View style={styles.previewHead}>
                  <Text style={[styles.eyebrow, { color: colors.inkMuted }]}>{t('inTouch.ifYes')}</Text>
                  {slots && slotsText ? (
                    <View
                      style={styles.pips}
                      accessible
                      accessibilityRole="image"
                      accessibilityLabel={t('inTouch.placesA11y', { text: slotsText })}
                      testID="in-touch-places"
                    >
                      {Array.from({ length: slots.limit }).map((_, i) => (
                        <View
                          key={i}
                          style={[
                            styles.pip,
                            { borderColor: colors.accent },
                            i < slots.in_touch
                              ? { backgroundColor: colors.accent }
                              : i < slots.in_touch + slots.waiting
                                ? { backgroundColor: colors.accentTintEdge }
                                : { backgroundColor: colors.surface },
                          ]}
                        />
                      ))}
                      <Text style={[styles.pipText, { color: colors.inkMuted }]}>{slotsText}</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.previewRow}>
                  <MentorFace animal={face.animal} colour={face.colour} size={44} />
                  <View style={styles.previewText}>
                    <Text style={[type.keyDense, styles.explainTitle, { color: colors.ink }]} numberOfLines={1}>
                      {firstMetAs ? displayName : t('inTouch.previewName')}
                    </Text>
                    <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={2}>
                      {t('inTouch.previewSub', { name: firstMetAs ?? displayName })}
                    </Text>
                  </View>
                  <InTouchBadge still />
                </View>
                <Text style={[type.caption, { color: colors.inkMuted }]}>{t('inTouch.previewNote')}</Text>
              </EdgeSurface>
            </Entrance>
          ) : null}

          {error ? (
            // Still on purpose (T&S #11): an error never arrives with motion.
            <View style={styles.errorBlock}>
              <Text style={[type.body, styles.centered, { color: colors.ink }]}>{error}</Text>
              <PrimaryButton label={t('common.retry')} variant="ghost" onPress={load} testID="retry" />
            </View>
          ) : null}

          <View style={styles.grow} />

          {profile && stay ? (
            state === 'asked' || state === 'in_touch' ? (
              // A confirmation is a still state: no arrival, no breathing mark.
              <View style={styles.actions} testID={state === 'asked' ? 'stay-in-touch-asked' : 'stay-in-touch-yes'}>
                <View
                  accessibilityRole="alert"
                  style={[styles.status, { backgroundColor: colors.accentTint, borderColor: colors.accent }]}
                >
                  <View style={[styles.statusCheck, { backgroundColor: colors.accent }]}>
                    <Ionicons name="checkmark" size={18} color={colors.onAccent} />
                  </View>
                  <Text style={[type.note, styles.statusCopy, { color: colors.ink }]}>
                    <Text style={styles.strong}>{state === 'asked' ? t('inTouch.askedLead') : t('inTouch.yesLead')}</Text>
                    {state === 'asked'
                      ? t('inTouch.askedBody', { name: displayName })
                      : t('inTouch.yesBody', { name: displayName })}
                  </Text>
                </View>
                <View style={styles.links}>
                  <PressKey
                    onPress={() => change(api.takeBackStayInTouch)}
                    edge="transparent"
                    travel={2}
                    haptic="none"
                    disabled={busy}
                    accessibilityLabel={state === 'asked' ? t('inTouch.takeBack') : t('inTouch.end')}
                    testID="stay-in-touch-take-back"
                    style={styles.link}
                  >
                    <Text style={[styles.linkText, styles.underlined, { color: colors.inkMuted }]}>
                      {state === 'asked' ? t('inTouch.takeBack') : t('inTouch.end')}
                    </Text>
                  </PressKey>
                  <PressKey
                    onPress={() => router.back()}
                    edge="transparent"
                    travel={2}
                    haptic="none"
                    accessibilityLabel={t('inTouch.backToChat')}
                    testID="stay-in-touch-back"
                    style={styles.link}
                  >
                    <Text style={[styles.linkText, { color: colors.accent }]}>{t('inTouch.backToChat')}</Text>
                  </PressKey>
                </View>
                <ReportLink onPress={reportOrBlock} label={t('mentorProfile.reportBlock')} />
              </View>
            ) : (
              <Entrance index={4} style={styles.actions}>
                {blockText ? (
                  <View
                    style={[styles.blocked, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                    testID={`stay-in-touch-blocked-${block}`}
                  >
                    <Text style={[type.note, { color: colors.ink }]}>{blockText}</Text>
                  </View>
                ) : null}
                <PressKey
                  onPress={() => change(api.askStayInTouch)}
                  edge={colors.accentEdge}
                  radius={radius.md}
                  intent="commit"
                  disabled={busy || Boolean(block)}
                  accessibilityLabel={t('inTouch.ask')}
                  testID="stay-in-touch-ask"
                  style={[styles.ask, { backgroundColor: colors.accent }]}
                >
                  <LinkedRings color={colors.onAccent} size={20} still={Boolean(block)} />
                  <Text style={[type.key, { color: colors.onAccent }]}>{t('inTouch.ask')}</Text>
                </PressKey>
                <ReportLink onPress={reportOrBlock} label={t('mentorProfile.reportBlock')} />
              </Entrance>
            )
          ) : profile ? (
            <View style={styles.actions}>
              <ReportLink onPress={reportOrBlock} label={t('mentorProfile.reportBlock')} />
            </View>
          ) : null}
        </DeepArrival>
      </ScrollView>
    </SafeAreaView>
  );
}

function ReportLink({ onPress, label }: { onPress: () => void; label: string }) {
  const { colors } = useTheme();
  return (
    <PressKey
      onPress={onPress}
      edge="transparent"
      travel={2}
      haptic="none"
      accessibilityLabel={label}
      testID="report-block"
      containerStyle={styles.reportBox}
      style={styles.link}
    >
      <Text style={[styles.linkText, styles.underlined, { color: colors.inkMuted }]}>{label}</Text>
    </PressKey>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  page: { flexGrow: 1, paddingTop: space.xs, paddingHorizontal: space.lg, paddingBottom: space.lg, gap: 14 },
  column: { flexGrow: 1, gap: 14 },
  hero: { paddingTop: 86 },
  figures: { position: 'absolute', left: 0, right: 0, top: 0, height: 116, zIndex: 2 },
  mentorFigure: { position: 'absolute', left: 18, top: 0 },
  memberFigure: { position: 'absolute', left: 104, top: 26 },
  heroCard: { paddingTop: 30, paddingHorizontal: 20, paddingBottom: 18, gap: 6, borderWidth: 1 },
  name: { fontFamily: font.sansHeavy, fontSize: 26, lineHeight: 34 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 8, height: 8, borderRadius: radius.pill },
  statusText: { flex: 1 },
  publicLine: { marginTop: 4 },
  explain: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: space.md, borderRadius: radius.lg, borderWidth: 1 },
  explainIcon: { width: 40, height: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  explainText: { flex: 1, minWidth: 0, gap: 2 },
  explainTitle: { lineHeight: 22 },
  preview: { paddingVertical: 14, paddingHorizontal: space.md, gap: space.sm, borderWidth: 1 },
  previewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  eyebrow: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18, letterSpacing: 0.5, textTransform: 'uppercase' },
  pips: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  pip: { width: 10, height: 10, borderRadius: radius.pill, borderWidth: 1.5 },
  pipText: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16, flexShrink: 1 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  previewText: { flex: 1, minWidth: 0 },
  grow: { flexGrow: 1 },
  actions: { gap: 12 },
  ask: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  blocked: { padding: 14, borderRadius: radius.md, borderWidth: 1 },
  status: {
    minHeight: 58,
    paddingVertical: 9,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  statusCheck: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  statusCopy: { flex: 1 },
  strong: { fontFamily: font.sansBold },
  links: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, flexWrap: 'wrap' },
  link: { height: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  linkText: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 20 },
  underlined: { textDecorationLine: 'underline' },
  reportBox: { alignSelf: 'center' },
  errorBlock: { alignItems: 'center', gap: space.sm },
  centered: { textAlign: 'center' },
});

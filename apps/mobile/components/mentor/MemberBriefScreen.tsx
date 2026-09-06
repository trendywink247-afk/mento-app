import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { EdgeSurface } from '@/components/EdgeSurface';
import { Companion } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { EndConfirmSheet } from '@/components/mentor/EndConfirmSheet';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { relativeTime } from '@/lib/format';
import { useI18n, type TKey } from '@/lib/i18n';
import { listenerApi, onListenerSessionLost, type MemberBrief } from '@/lib/listenerApi';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { accentFor, COMPANION_COLOR_LABELS, type CompanionColor } from '@/theme/companion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/**
 * Mentee brief — "Context for care" (spec §4, mentor side of the chat-profiles
 * work; the member-side equivalent is MentorProfileScreen). Reached by tapping the
 * member header in the mentor's chat (`testID="member-header"` in
 * MentorChatScreen(.web).tsx). Renders the persona name it already has from route
 * params immediately, then fills in the rest from GET /listener/me/conversations/
 * {id}/brief. Never shows age, email, identity, or Quiet-Pause state (T&S #7,
 * spec §4.2's "deliberately not shown" list).
 *
 * The member's companion COLOUR is a per-user accent (theme/companion.ts), not a
 * global theme override — this screen calls `accentFor()` directly to derive a
 * wash/ring around the companion art (the art itself is not colour-tinted; see
 * assets/companions/generated) rather than re-theming the whole screen, which
 * would also recolour the mentor's own chrome (back chevron, action keys).
 */
export default function MemberBriefScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const { id, member, masked } = useLocalSearchParams<{
    id: string;
    member?: string;
    masked?: string;
  }>();
  const memberName = member ?? '';

  const [brief, setBrief] = useState<MemberBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [ending, setEnding] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(false);
    try {
      setBrief(await listenerApi.brief(id));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load, attempt]);

  // Suspension / expired token mid-read — fall back to Mentor Home, the same
  // guard the console itself uses (lib/useMentorConsole.ts).
  useEffect(() => onListenerSessionLost(() => router.replace('/mentor-home')), [router]);

  const endNow = async () => {
    if (ending || !id) return;
    setEnding(true);
    try {
      await listenerApi.end(id);
      router.replace('/mentor-home');
    } catch {
      // Stay still and silent (T&S #11) — release the spinner, fold the confirm back.
      setEnding(false);
      setConfirmingEnd(false);
    }
  };

  const away = brief ? brief.member_masked : masked === '1';
  const animal = brief?.companion_animal ?? null;
  const colourSlug = brief?.companion_colour ?? null;
  const accent = accentFor(colourSlug);
  const colourLabel = colourSlug
    ? (COMPANION_COLOR_LABELS[colourSlug as CompanionColor] ?? colourSlug)
    : null;

  const captionKey: TKey = animal
    ? away
      ? 'mentor.brief.memberAway'
      : 'mentor.brief.memberHere'
    : away
      ? 'mentor.brief.memberPlainAway'
      : 'mentor.brief.memberPlainHere';
  const captionParams = animal ? { animal, colour: colourLabel ?? '' } : undefined;

  return (
    <Screen onBack={() => router.back()} scroll>
      <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
        {t('mentor.brief.title')}
      </Text>

      <View style={styles.identityRow}>
        {animal ? (
          <View
            style={[
              styles.companionWash,
              { backgroundColor: accent.accentTint, borderColor: accent.accentEdge },
            ]}
          >
            <Companion
              animal={animal as CompanionAnimal}
              size={56}
              awake
              trigger={reduced ? null : { kind: 'curious', n: 1 }}
            />
          </View>
        ) : (
          <PersonaAvatar name={memberName} size={56} online={!away} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: colors.ink }]} numberOfLines={1}>
            {brief?.persona_name ?? memberName}
          </Text>
          <Text style={[type.caption, { color: away ? colors.inkMuted : colors.success }]} numberOfLines={1}>
            {t(captionKey, captionParams)}
          </Text>
        </View>
      </View>

      {loading && !brief ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center} testID="brief-error">
          <Text style={[type.body, { color: colors.danger, textAlign: 'center' }]}>
            {t('mentorHome.loadError')}
          </Text>
          <PressKey
            onPress={() => setAttempt((a) => a + 1)}
            edge={colors.accentEdge}
            radius={radius.pill}
            style={[styles.retryBtn, { backgroundColor: colors.accent }]}
            testID="brief-retry"
          >
            <Text style={[type.label, { color: colors.onAccent }]}>{t('common.retry')}</Text>
          </PressKey>
        </View>
      ) : brief ? (
        <Entrance index={0}>
          <View testID="brief-ready" style={{ gap: space.md }}>
            <EdgeSurface
              edge={colors.edgeAlt}
              radius={radius.md}
              style={[styles.card, { backgroundColor: colors.surfaceAlt }]}
            >
              <Text style={[type.label, { color: colors.ink }]}>{t('mentor.brief.why')}</Text>
              {brief.issue_category_label ? (
                <Text style={[type.body, { color: colors.inkMuted }]}>
                  {t('mentor.brief.picked', { topic: brief.issue_category_label })}
                </Text>
              ) : null}
              {brief.community_label ? (
                <Text style={[type.body, { color: colors.inkMuted }]}>
                  {t('mentor.brief.lens', {
                    lens: [brief.community_label, brief.journey_stage_label].filter(Boolean).join(' · '),
                  })}
                </Text>
              ) : null}
              <Text style={[type.body, { color: colors.inkMuted }]}>
                {t('mentor.brief.started', { when: relativeTime(brief.created_at, t) })}
              </Text>
            </EdgeSurface>

            <EdgeSurface
              edge={colors.edgeAlt}
              radius={radius.md}
              style={[styles.card, { backgroundColor: colors.surfaceAlt }]}
            >
              <Text style={[type.label, { color: colors.ink }]}>{t('mentor.brief.inChat')}</Text>
              <View style={styles.factRow}>
                <Text style={[type.body, { color: colors.inkMuted }]}>{t('mentor.brief.lastMessage')}</Text>
                <Text style={[type.body, { color: colors.ink }]}>
                  {brief.last_message_at ? relativeTime(brief.last_message_at, t) : t('mentor.brief.unavailable')}
                </Text>
              </View>
              <View style={styles.factRow}>
                <Text style={[type.body, { color: colors.inkMuted }]}>{t('mentor.brief.safety')}</Text>
                <Text style={[type.body, { color: brief.safety_flags_open ? colors.danger : colors.ink }]}>
                  {brief.safety_flags_open
                    ? t('mentor.brief.safetyOpen', { count: brief.safety_flags_open })
                    : t('mentor.brief.safetyNone')}
                </Text>
              </View>
            </EdgeSurface>

            <View>
              <Text style={[type.label, styles.nextStepLabel, { color: colors.ink }]}>
                {t('mentor.brief.nextStep')}
              </Text>
              <View
                style={[
                  styles.promptBlock,
                  { backgroundColor: accent.accentTint, borderLeftColor: accent.accentEdge },
                ]}
              >
                <Text style={[type.body, styles.promptText, { color: colors.ink }]}>{brief.care_prompt}</Text>
              </View>
            </View>

            <View style={{ gap: space.sm }}>
              <PressKey
                onPress={() => router.push('/mentor/helplines')}
                edge={colors.edgeSurface}
                radius={radius.pill}
                style={[styles.actionBtn, { backgroundColor: colors.surfaceAlt }]}
                testID="brief-helplines"
              >
                <Text style={[type.label, { color: colors.ink }]}>{t('mentor.chat.helplines')}</Text>
              </PressKey>
              <PressKey
                onPress={() => router.push({ pathname: '/mentor/report', params: { id } })}
                edge={colors.edgeSurface}
                radius={radius.pill}
                style={[styles.actionBtn, { backgroundColor: colors.surfaceAlt }]}
                testID="brief-report"
              >
                <Text style={[type.label, { color: colors.danger }]}>{t('mentor.chat.report')}</Text>
              </PressKey>

              {confirmingEnd ? (
                <EndConfirmSheet
                  busy={ending}
                  onConfirm={() => void endNow()}
                  onCancel={() => setConfirmingEnd(false)}
                />
              ) : (
                <PressKey
                  onPress={() => setConfirmingEnd(true)}
                  edge={colors.edgeInk}
                  radius={radius.pill}
                  style={[styles.actionBtn, { backgroundColor: colors.ink }]}
                  testID="brief-end"
                >
                  <Text style={[type.label, { color: colors.onAccent }]}>{t('mentor.chat.end')}</Text>
                </PressKey>
              )}
            </View>
          </View>
        </Entrance>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: font.sansHeavy, fontSize: 24, lineHeight: 32, marginBottom: space.md },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.lg },
  companionWash: {
    width: 68,
    height: 68,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { fontFamily: font.sansBold, fontSize: 20, lineHeight: 26 },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.md, paddingVertical: space.xl },
  retryBtn: { paddingHorizontal: space.lg, paddingVertical: space.sm },
  card: { padding: space.md, gap: space.xs },
  factRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  nextStepLabel: { marginBottom: space.xs },
  promptBlock: {
    borderLeftWidth: 3,
    borderRadius: radius.sm,
    padding: space.md,
  },
  promptText: { fontStyle: 'italic' },
  actionBtn: { paddingVertical: space.sm, alignItems: 'center' },
});

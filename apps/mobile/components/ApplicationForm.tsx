import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { api, ApiError, type ListenerApplication } from '@/lib/api';
import { useI18n, type TKey } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS } from '@/theme/companion';
import { colors as base, radius, space, type, wash, washEdge } from '@/theme/tokens';

// Must match services/api/app/services/paths_data.py COMMUNITIES (server validates; drift = submit-time 422).
const COMMUNITIES = ['upsc', 'neet', 'jee', 'exams', 'life'] as const;
// Must match ListenerApplicationIn.availability — the single-choice commitment, kept in the
// contract (DECISIONS §L, founder-delegated 2026-09-19) and drawn as the board's quiet
// caption "A few hours a week" beside the chips; tapping it steps through the four.
const AVAILABILITY = ['few_hours', 'most_evenings', 'weekends', 'varies'] as const;
type Availability = (typeof AVAILABILITY)[number];
// Board A37's time-of-day chips (multi-select, at least one). The server also accepts
// afternoons / late_nights for later; the board draws these three.
const TIMES = ['mornings', 'evenings', 'weekends'] as const;
type Time = (typeof TIMES)[number];
const MIN_WHY = 40;

// Same shape as components/onboarding/steps/EmailStep.tsx — a friendly client-side
// check so a typo never round-trips to the server's EmailStr 422.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The sage "picked" ink the board uses for every chosen chip and the ticked pledge. */
const SAGE_INK = COMPANION_COLORS.sage.accentEdge;

/** The become-a-mentor application (board A37 form) — shared by the member-flow screen
 * (app/listener-apply.tsx), Mentor Home (no application yet) and the public page
 * (app/apply.tsx). Assumes a session already exists (the member's own, or a throwaway
 * one the caller minted via onboarding/start for the public path). The pledge is a hard
 * gate (T&S #2): until it is ticked Submit is a dashed, disabled key. */
export function ApplicationForm({ onSuccess }: { onSuccess: (result: ListenerApplication) => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [motivation, setMotivation] = useState('');
  const [communities, setCommunities] = useState<string[]>([]);
  const [availability, setAvailability] = useState<Availability>('few_hours');
  const [times, setTimes] = useState<Time[]>([]);
  const [email, setEmail] = useState('');
  const [pledged, setPledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const whyLeft = Math.max(0, MIN_WHY - motivation.trim().length);
  const valid = whyLeft === 0 && times.length > 0 && pledged;
  // The one line under Submit names the first thing still missing — the pledge first.
  const gate = !pledged
    ? t('mentorApply.gatePledge')
    : whyLeft > 0
      ? t('mentorApply.gateWhy', { count: whyLeft })
      : times.length === 0
        ? t('mentorApply.gateAvailability')
        : null;

  const toggleCommunity = (slug: string) =>
    setCommunities((cs) => (cs.includes(slug) ? cs.filter((c) => c !== slug) : [...cs, slug]));
  const toggleTime = (slot: Time) =>
    setTimes((ts) => (ts.includes(slot) ? ts.filter((x) => x !== slot) : [...ts, slot]));
  const nextCommitment = () =>
    setAvailability((a) => AVAILABILITY[(AVAILABILITY.indexOf(a) + 1) % AVAILABILITY.length]);

  const submit = async () => {
    if (!valid || submitting) return;
    const trimmedEmail = email.trim();
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
      setError(t('mentorApply.emailInvalid'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.submitListenerApplication({
        motivation: motivation.trim(),
        communities,
        availability,
        available_times: TIMES.filter((slot) => times.includes(slot)),
        email: trimmedEmail ? trimmedEmail : null,
        // The board has no paid-mentoring opt-in (never hint at a paid tier); the
        // server field stays, always false from this form.
        mentor_interest: false,
        pledge_accepted: true,
      });
      onSuccess(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('mentorApply.error'));
      setSubmitting(false);
    }
  };

  const field = [styles.field, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.ink }];

  const chip = (id: string, label: string, on: boolean, onPress: () => void, testID: string) => (
    <PressKey
      key={id}
      onPress={onPress}
      edge={on ? washEdge.green : colors.edgeSurface}
      travel={4}
      radius={radius.pill}
      intent="select"
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      testID={testID}
      style={[
        styles.chip,
        { backgroundColor: on ? wash.green : colors.surface, borderColor: on ? washEdge.green : colors.border },
      ]}
    >
      {on ? <Ionicons name="checkmark" size={16} color={SAGE_INK} /> : null}
      <Text style={[type.rowTitle, { color: on ? SAGE_INK : colors.ink }]}>{label}</Text>
    </PressKey>
  );

  return (
    <View style={styles.form}>
      <Entrance index={0} style={styles.group}>
        <Text style={[type.rowTitle, { color: colors.ink }]}>{t('mentorApply.whyLabel')}</Text>
        <EdgeSurface edge={colors.edgeSurface} travel={4} radius={radius.md} style={styles.bare}>
          <TextInput
            value={motivation}
            onChangeText={setMotivation}
            multiline
            maxLength={500}
            placeholder={t('mentorApply.whyPlaceholder')}
            placeholderTextColor={colors.inkMuted}
            accessibilityLabel={t('mentorApply.whyLabel')}
            style={[field, styles.why]}
            testID="apply-motivation"
          />
        </EdgeSurface>
      </Entrance>

      <Entrance index={1} style={styles.group}>
        <View style={styles.labelRow}>
          <Text style={[type.rowTitle, styles.shrink, { color: colors.ink }]}>{t('mentorApply.communitiesLabel')}</Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentorApply.communitiesHint')}</Text>
        </View>
        <View style={styles.chips}>
          {COMMUNITIES.map((slug) =>
            chip(
              slug,
              t(`mentorApply.community_${slug}` as TKey),
              communities.includes(slug),
              () => toggleCommunity(slug),
              `apply-community-${slug}`,
            ),
          )}
        </View>
      </Entrance>

      <Entrance index={2} style={styles.group}>
        <View style={styles.labelRow}>
          <Text style={[type.rowTitle, styles.shrink, { color: colors.ink }]}>{t('mentorApply.availabilityLabel')}</Text>
          {/* reason: the board draws this as a quiet caption, not a card — the key's face and
              edge are both the page ground (no visible lip); its 44 px tap height is taken
              back by negative margins so the label row keeps the board's rhythm. */}
          <PressKey
            onPress={nextCommitment}
            edge={colors.bg}
            travel={2}
            radius={radius.sm}
            intent="select"
            accessibilityLabel={t('availabilityTimes.commitmentA11y', {
              value: t(`mentorApply.availability_${availability}` as TKey),
            })}
            testID="apply-commitment"
            containerStyle={styles.commitmentWrap}
            style={[styles.commitment, { backgroundColor: colors.bg }]}
          >
            <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={1}>
              {t(`mentorApply.availability_${availability}` as TKey)}
            </Text>
            <Ionicons name="chevron-expand-outline" size={14} color={colors.inkMuted} />
          </PressKey>
        </View>
        <View style={styles.chips}>
          {TIMES.map((slot) =>
            chip(
              slot,
              t(`availabilityTimes.time_${slot}` as TKey),
              times.includes(slot),
              () => toggleTime(slot),
              `apply-time-${slot}`,
            ),
          )}
        </View>
      </Entrance>

      <Entrance index={3} style={styles.group}>
        <View style={styles.labelRow}>
          <Text style={[type.rowTitle, styles.shrink, { color: colors.ink }]}>{t('mentorApply.emailLabel')}</Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentorApply.emailHint')}</Text>
        </View>
        <EdgeSurface edge={colors.edgeSurface} travel={4} radius={radius.md} style={styles.bare}>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder={t('mentorApply.emailPlaceholder')}
            placeholderTextColor={colors.inkMuted}
            accessibilityLabel={t('mentorApply.emailLabel')}
            style={[field, styles.email]}
            testID="apply-email"
          />
        </EdgeSurface>
        <Text style={[type.caption, styles.emailNote, { color: colors.inkMuted }]}>{t('mentorApply.emailNote')}</Text>
      </Entrance>

      <Entrance index={4}>
        <PressKey
          onPress={() => setPledged((v) => !v)}
          edge={pledged ? washEdge.green : colors.edgeSurface}
          travel={4}
          radius={radius.md}
          intent="toggle"
          accessibilityRole="checkbox"
          accessibilityState={{ checked: pledged }}
          accessibilityLabel={t('mentorApply.pledge')}
          testID="apply-pledge"
          style={[
            styles.pledge,
            { backgroundColor: pledged ? wash.green : colors.surface, borderColor: pledged ? washEdge.green : colors.border },
          ]}
        >
          <View
            style={[
              styles.box,
              pledged
                ? { backgroundColor: SAGE_INK, borderColor: SAGE_INK }
                : { backgroundColor: colors.surfaceAlt, borderColor: colors.inkMuted },
            ]}
          >
            {pledged ? <Ionicons name="checkmark" size={18} color={colors.onAccent} /> : null}
          </View>
          <Text style={[type.rowTitle, styles.shrink, { color: pledged ? SAGE_INK : colors.ink }]}>
            {t('mentorApply.pledge')}
          </Text>
        </PressKey>
      </Entrance>

      {/* Paid mentoring — founder 2026-09-19: "a placeholder, we are yet to confirm that. Coming
          soon." (DECISIONS §L.13). Mentor sign-up only (this form never renders on a member
          screen); a still, non-interactive card: no checkbox, no price, no promise, and
          `mentor_interest` stays false. Nothing here may suggest that members pay (T&S #4). */}
      <Entrance index={5}>
        <EdgeSurface
          edge={colors.edgeAlt}
          travel={3}
          radius={radius.md}
          style={[styles.soon, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
          testID="apply-paid-placeholder"
        >
          <Ionicons name="hourglass-outline" size={18} color={colors.inkMuted} />
          <View style={styles.shrink}>
            <Text style={[type.rowTitle, { color: colors.ink }]}>
              {t('mentorPaid.title')}
              <Text style={{ color: colors.inkMuted }}>{` · ${t('mentorPaid.soon')}`}</Text>
            </Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentorPaid.body')}</Text>
          </View>
        </EdgeSurface>
      </Entrance>

      {error ? (
        <Text style={[type.note, styles.center, { color: colors.ink }]} testID="apply-error" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      <Entrance index={6} style={styles.submitWrap}>
        {valid ? (
          <PrimaryButton
            label={t('mentorApply.submit')}
            shape="key"
            trailing="arrow"
            onPress={() => void submit()}
            loading={submitting}
            testID="apply-submit"
          />
        ) : (
          // The gate: a dashed, flat, disabled key — no pillow edge, nothing to press.
          <View
            style={[styles.gated, { backgroundColor: base.bgLavender, borderColor: colors.dotIdle }]}
            accessible
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            accessibilityLabel={t('mentorApply.submit')}
            accessibilityHint={gate ?? undefined}
            aria-disabled
            testID="apply-submit"
          >
            <Ionicons name="lock-closed-outline" size={18} color={colors.inkMuted} />
            <Text style={[type.keyDense, { color: colors.inkMuted }]}>{t('mentorApply.submit')}</Text>
          </View>
        )}
        <Text style={[type.caption, styles.center, styles.gateLine, { color: colors.inkMuted }]} testID="apply-gate">
          {gate ?? t('mentorApply.submitNote')}
        </Text>
      </Entrance>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 14 },
  group: { gap: 6 },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  commitmentWrap: { marginVertical: -12, flexShrink: 1 },
  commitment: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 12, paddingLeft: space.xs },
  shrink: { flexShrink: 1 },
  bare: { padding: 0 },
  field: { borderWidth: 1, borderRadius: radius.md, ...type.body, fontSize: 15, lineHeight: 22 },
  why: { minHeight: 100, paddingHorizontal: 14, paddingVertical: 12, textAlignVertical: 'top' },
  email: { height: 52, paddingHorizontal: space.md, fontSize: 16, lineHeight: 24 },
  emailNote: { paddingTop: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.sm, rowGap: 10, paddingBottom: space.xs },
  chip: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  pledge: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: space.sm,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  box: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  soon: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  submitWrap: { paddingBottom: space.xs },
  gated: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.md,
  },
  gateLine: { paddingTop: 10 },
  center: { textAlign: 'center' },
});

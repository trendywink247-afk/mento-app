import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { PrimaryButton } from '@/components/PrimaryButton';
import { api, ApiError, type ListenerApplication } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

// Must match services/api/app/services/paths_data.py COMMUNITIES (server validates; drift = submit-time 422).
const COMMUNITIES = [
  { slug: 'upsc', label: 'UPSC' },
  { slug: 'neet', label: 'NEET' },
  { slug: 'jee', label: 'JEE' },
  { slug: 'exams', label: 'Other exams' },
  { slug: 'life', label: 'Life' },
];
const AVAILABILITY = [
  { key: 'few_hours', label: 'A few hours a week' },
  { key: 'most_evenings', label: 'Most evenings' },
  { key: 'weekends', label: 'Weekends' },
  { key: 'varies', label: 'It varies' },
] as const;

// Same shape as components/onboarding/steps/EmailStep.tsx — a friendly client-side
// check so a typo never round-trips to the server's EmailStr 422.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The become-a-listener application fields (spec 2026-07-24) — shared between the
 * member-flow screen (app/listener-apply.tsx) and the public landing page
 * (app/apply.tsx). Assumes a session already exists (either the member's own, or a
 * throwaway one the caller minted via onboarding/start for the public path); the
 * pledge is a hard gate (T&S: listeners are not therapists). */
export function ApplicationForm({ onSuccess }: { onSuccess: (result: ListenerApplication) => void }) {
  const { colors, elevation } = useTheme();
  const [motivation, setMotivation] = useState('');
  const [communities, setCommunities] = useState<string[]>([]);
  const [availability, setAvailability] = useState<(typeof AVAILABILITY)[number]['key'] | null>(null);
  const [email, setEmail] = useState('');
  const [mentorInterest, setMentorInterest] = useState(false);
  const [pledged, setPledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = motivation.trim().length >= 40 && availability !== null && pledged;

  const toggleCommunity = (slug: string) =>
    setCommunities((cs) => (cs.includes(slug) ? cs.filter((c) => c !== slug) : [...cs, slug]));

  const submit = async () => {
    if (!valid || submitting || availability === null) return;
    const trimmedEmail = email.trim();
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
      setError("That email doesn't look right — or leave it blank.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.submitListenerApplication({
        motivation: motivation.trim(),
        communities,
        availability,
        email: trimmedEmail ? trimmedEmail : null,
        mentor_interest: mentorInterest,
        pledge_accepted: true,
      });
      onSuccess(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong — please try again.');
      setSubmitting(false);
    }
  };

  const chip = (selected: boolean) => [
    styles.chip,
    { backgroundColor: selected ? colors.accentTint : colors.surface, borderColor: selected ? colors.accent : colors.border },
  ];

  return (
    <View>
      <Text style={[styles.label, { color: colors.ink }]}>Why do you want to listen?</Text>
      <TextInput
        value={motivation}
        onChangeText={setMotivation}
        multiline
        maxLength={500}
        placeholder="A few honest sentences — what brings you here?"
        placeholderTextColor={colors.inkMuted}
        style={[styles.input, { backgroundColor: colors.surface, color: colors.ink, borderColor: colors.border }]}
        testID="apply-motivation"
      />
      <Text style={[type.caption, { color: colors.inkMuted, textAlign: 'right' }]}>
        {motivation.trim().length < 40 ? `${40 - motivation.trim().length} more characters` : `${motivation.length}/500`}
      </Text>

      <Text style={[styles.label, { color: colors.ink }]}>Roads you've walked</Text>
      <View style={styles.chips}>
        {COMMUNITIES.map((c) => (
          <Pressable
            key={c.slug}
            onPress={() => toggleCommunity(c.slug)}
            accessibilityRole="button"
            accessibilityState={{ selected: communities.includes(c.slug) }}
            style={chip(communities.includes(c.slug))}
            testID={`apply-community-${c.slug}`}
          >
            <Text style={[type.bodySemi, { color: colors.ink }]}>{c.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.label, { color: colors.ink }]}>When could you usually listen?</Text>
      <View style={styles.chips}>
        {AVAILABILITY.map((a) => (
          <Pressable
            key={a.key}
            onPress={() => setAvailability(a.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: availability === a.key }}
            style={chip(availability === a.key)}
            testID={`apply-availability-${a.key}`}
          >
            <Text style={[type.bodySemi, { color: colors.ink }]}>{a.label}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={[styles.label, { color: colors.ink }]}>Email (optional)</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        placeholder="Only for sending your mentor link"
        placeholderTextColor={colors.inkMuted}
        style={[styles.input, styles.inputSingle, { backgroundColor: colors.surface, color: colors.ink, borderColor: colors.border }]}
        testID="apply-email"
      />

      <Pressable
        onPress={() => setMentorInterest((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: mentorInterest }}
        style={styles.checkRow}
        testID="apply-mentor-interest"
      >
        <Ionicons
          name={mentorInterest ? 'checkbox' : 'square-outline'}
          size={22}
          color={mentorInterest ? colors.accent : colors.inkMuted}
        />
        <Text style={[type.body, { color: colors.ink, flex: 1 }]}>
          I'd be interested in paid mentoring, later
        </Text>
      </Pressable>

      <Pressable
        onPress={() => setPledged((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: pledged }}
        style={[styles.pledge, { backgroundColor: colors.surface }, elevation.sm]}
        testID="apply-pledge"
      >
        <Ionicons
          name={pledged ? 'checkbox' : 'square-outline'}
          size={22}
          color={pledged ? colors.accent : colors.inkMuted}
        />
        <Text style={[type.body, { color: colors.ink, flex: 1 }]}>
          Mentors are not therapists. I'll listen, not diagnose — and when someone
          needs clinical help, I'll point them toward it.
        </Text>
      </Pressable>

      {error ? (
        <Text style={[type.body, { color: colors.danger, textAlign: 'center' }]} testID="apply-error">
          {error}
        </Text>
      ) : null}

      <View style={{ marginTop: space.md }}>
        <PrimaryButton
          label="Send application"
          onPress={() => void submit()}
          disabled={!valid}
          loading={submitting}
          testID="apply-submit"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 23, marginTop: space.md, marginBottom: space.xs },
  input: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.sm,
    minHeight: 110,
    textAlignVertical: 'top',
  },
  inputSingle: { minHeight: 48, textAlignVertical: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.xs + 2,
    minHeight: 44,
    justifyContent: 'center',
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: space.md, minHeight: 44 },
  pledge: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.md,
    marginTop: space.md,
  },
});

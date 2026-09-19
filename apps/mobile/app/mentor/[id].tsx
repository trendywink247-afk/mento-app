import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { MentorFace } from '@/components/art/MentorFace';
import { ApiError, api, type Listener } from '@/lib/api';
import { formatTopic } from '@/lib/format';
import { requestLetter } from '@/lib/requestLetter';
import { useI18n } from '@/lib/i18n';
import { TOPICS } from '@/lib/topics';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';


/** Mentor profile (#50/51, anonymity-safe: persona avatar instead of photo covers,
 * no star ratings) → intro composer (#52) → the letter on its way (board A04, app/request-sent). */
export default function MentorProfile() {
  const router = useRouter();
  const { colors, elevation } = useTheme();
  const { t: tr } = useI18n();
  // `topic` arrives from the New chat sheet via Browse: the chip picked there is already lit
  // here, and travels on as the request's `issue_category` (lib/topics.ts).
  const { id, topic: topicParam } = useLocalSearchParams<{ id: string; topic?: string }>();
  const [listener, setListener] = useState<Listener | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<'profile' | 'compose'>('profile');
  const [intro, setIntro] = useState('');
  const [topic, setTopic] = useState<string | null>(topicParam ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .listListeners()
      .then((all) => {
        if (active) setListener(all.find((l) => l.id === id) ?? null);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);

  const send = async () => {
    if (!listener || !intro.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const sent = await api.requestListener(listener.id, intro.trim(), topic);
      // The letter (board A04) paints from what we already hold, then re-reads the server.
      requestLetter.put({
        request: sent,
        mentor: { id: listener.id, name: listener.persona_name, avatar: listener.persona_avatar },
      });
      // `replace`: back from the letter returns to Browse, never to a sent intro.
      router.replace({ pathname: '/request-sent/[id]', params: { id: sent.id } });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Screen onBack={() => router.back()}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </Screen>
    );
  }

  if (!listener) {
    return (
      <Screen onBack={() => router.back()}>
        <View style={styles.center}>
          <IconBadge icon="cloud-offline-outline" tone="indigo" size={56} />
          <Text style={[type.body, { color: colors.inkMuted }]}>
            We couldn't find this mentor.
          </Text>
        </View>
      </Screen>
    );
  }

  if (step === 'compose') {
    return (
      <Screen
        bg="lavender"
        onBack={() => setStep('profile')}
        scroll
        footer={
          <>
            {error ? (
              <Text style={[type.caption, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
            ) : null}
            <PrimaryButton
              label="Send Request"
              onPress={() => void send()}
              disabled={!intro.trim()}
              loading={busy}
              testID="send-request"
            />
            <PrimaryButton label="Cancel" variant="link" onPress={() => setStep('profile')} testID="cancel-request" />
          </>
        }
      >
        <View style={styles.composeHead}>
          <MentorFace animal={listener.companion_animal} colour={listener.companion_colour} size={72} presence={listener.available} />
          <Text style={[styles.name, { color: colors.ink }]}>{listener.persona_name}</Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>
            Tell them a little about what's on your mind.
          </Text>
        </View>

        <Text style={[styles.label, { color: colors.ink }]}>Intro Message</Text>
        <TextInput
          style={[styles.textarea, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.ink }]}
          placeholder="What would you like to talk about?"
          placeholderTextColor={colors.inkMuted}
          value={intro}
          onChangeText={(v) => setIntro(v.slice(0, 160))}
          multiline
          accessibilityLabel="Intro message"
          testID="intro-input"
        />
        <Text style={[type.caption, styles.counter, { color: colors.inkMuted }]}>
          {intro.length}/160
        </Text>

        <Text style={[styles.label, { color: colors.ink }]}>Topic (optional)</Text>
        <View style={styles.chips}>
          {TOPICS.map(({ slug, label }) => {
            const selected = topic === slug;
            return (
              <Pressable
                key={slug}
                onPress={() => setTopic(selected ? null : slug)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                testID={`topic-${slug}`}
                style={[
                  styles.chip,
                  selected
                    ? { backgroundColor: colors.accent }
                    : { borderWidth: 1, borderColor: colors.accentSoft },
                ]}
              >
                <Text style={[styles.chipText, { color: selected ? colors.onAccent : colors.accent }]}>
                  {tr(label)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={[styles.privacy, { backgroundColor: colors.surfaceAlt }]}>
          <Ionicons name="lock-closed-outline" size={15} color={colors.accentSoft} />
          <Text style={[type.caption, { color: colors.inkMuted, flex: 1 }]}>
            Your message stays between you and this mentor. Your identity is never shared.
          </Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen
      onBack={() => router.back()}
      scroll
      footer={
        <PrimaryButton
          label="Start Conversation"
          trailing="chevron"
          onPress={() => setStep('compose')}
          testID="start-conversation"
        />
      }
    >
      <View style={styles.composeHead}>
        <MentorFace animal={listener.companion_animal} colour={listener.companion_colour} size={96} presence={listener.available} />
        <Text style={[styles.name, { color: colors.ink }]}>{listener.persona_name}</Text>
        <Text style={[type.caption, { color: listener.available ? colors.success : colors.inkMuted }]}>
          {listener.available ? '● Available now' : listener.status === 'online' ? 'At capacity' : 'Away'}
        </Text>
      </View>

      <View style={[styles.aboutCard, { backgroundColor: colors.surface }, elevation.sm]}>
        <Text style={[type.label, { color: colors.ink }]}>About</Text>
        <Text style={[type.body, { color: colors.inkMuted }]}>
          Here to listen and support, without judgment. A real person who volunteers their time
          so no one has to carry a hard moment alone.
        </Text>
      </View>

      {listener.categories.length ? (
        <View style={[styles.aboutCard, { backgroundColor: colors.surface }, elevation.sm]}>
          <Text style={[type.label, { color: colors.ink }]}>Can help with</Text>
          <View style={styles.chips}>
            {listener.categories.map((c) => (
              <View key={c} style={[styles.tag, { backgroundColor: colors.surfaceAlt }]}>
                <Text style={[styles.chipText, { color: colors.accent }]}>{formatTopic(c)}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={[styles.privacy, { backgroundColor: colors.surfaceAlt }]}>
        <Ionicons name="heart-outline" size={15} color={colors.accentSoft} />
        <Text style={[type.caption, { color: colors.inkMuted, flex: 1 }]}>
          No star ratings here — mentors are people, not products. Listeners are not therapists.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  composeHead: { alignItems: 'center', gap: space.xs, marginVertical: space.md },
  name: { fontFamily: font.serifBold, fontSize: 26, lineHeight: 33 },
  label: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 22, marginTop: space.md, marginBottom: space.xs },
  textarea: {
    minHeight: 110,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
    textAlignVertical: 'top',
    ...type.body,
  },
  counter: { textAlign: 'right', marginTop: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.xs },
  chip: { borderRadius: radius.pill, paddingVertical: space.xs + 2, paddingHorizontal: space.sm + 4 },
  chipText: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  tag: { borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: space.sm },
  aboutCard: { borderRadius: radius.lg, padding: space.md, gap: space.xs, marginBottom: space.sm },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.xs,
  },
});

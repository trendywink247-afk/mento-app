import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { ApiError, api } from '@/lib/api';
import { clearDraft, getDraft } from '@/lib/onboardingDraft';
import { saveSession } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

const GUIDELINES: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  { icon: 'heart-outline', title: 'This is a safe place', body: 'We listen and support, without judgment.' },
  { icon: 'lock-closed-outline', title: 'Keep your identity private', body: 'You are anonymous here — no names, no photos.' },
  { icon: 'leaf-outline', title: 'Reflect and grow', body: 'Use this space to understand yourself a little better.' },
  { icon: 'happy-outline', title: 'Be yourself', body: 'Honesty builds meaningful conversations.' },
  { icon: 'people-outline', title: 'Respect each other', body: "Let's keep this a kind, gentle space." },
];

export default function ConnectingScreen() {
  const router = useRouter();
  const { colors, elevation } = useTheme();
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setError(null);
    const draft = getDraft();
    if (!draft.dob) {
      router.replace('/onboarding/age');
      return;
    }
    try {
      const onboarding = await api.startOnboarding({
        dob: draft.dob,
        email: draft.email ?? null,
        companion_animal: draft.companionAnimal ?? null,
        companion_colour: draft.companionColour ?? null,
      });
      await saveSession(onboarding.session_token, onboarding.stream_token, onboarding.user);

      const match = await api.match({ kind: 'general' });
      clearDraft();
      router.replace({
        pathname: '/chat/[id]',
        params: {
          id: match.conversation_id,
          listener: match.listener_persona_name,
          channel: match.stream_channel_id ?? '',
        },
      });
    } catch (e) {
      const msg =
        e instanceof ApiError
          ? e.message
          : 'We had trouble connecting. Please check your network and try again.';
      setError(msg);
    }
  };

  useEffect(() => {
    void connect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen
      footer={error ? <PrimaryButton label="Try again" onPress={() => void connect()} testID="retry" /> : undefined}
    >
      <View style={styles.head}>
        {error ? (
          <Ionicons name="cloud-offline-outline" size={40} color={colors.inkMuted} />
        ) : (
          <ActivityIndicator size="large" color={colors.accent} />
        )}
        <Text style={[type.title, styles.title, { color: colors.ink }]} accessibilityRole="header">
          {error ? "We couldn't connect just yet" : 'Finding the right person for you…'}
        </Text>
        <Text style={[type.body, styles.sub, { color: colors.inkMuted }]}>
          {error ?? "While you wait, here's what makes Mento a safe space."}
        </Text>
      </View>

      {!error ? (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, elevation.sm]}>
          {GUIDELINES.map((g, i) => (
            <View key={g.title} style={[styles.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.border }]}>
              <View style={[styles.iconWrap, { backgroundColor: colors.brandTint }]}>
                <Ionicons name={g.icon} size={18} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[type.label, { color: colors.ink }]}>{g.title}</Text>
                <Text style={[type.caption, { color: colors.inkMuted }]}>{g.body}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', gap: space.sm, marginTop: space.xl, marginBottom: space.lg },
  title: { textAlign: 'center' },
  sub: { textAlign: 'center' },
  card: { borderRadius: radius.lg, borderWidth: 1, paddingHorizontal: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

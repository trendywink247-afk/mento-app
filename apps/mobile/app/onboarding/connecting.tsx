import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { ApiError, api } from '@/lib/api';
import { clearDraft, getDraft } from '@/lib/onboardingDraft';
import { saveSession } from '@/lib/session';
import { colors, space, type } from '@/theme/tokens';

const GUIDELINES = [
  'This is a safe place. We listen and support, without judgment.',
  'Keep your identity private — you are anonymous here.',
  'Be yourself. Honesty builds meaningful conversations.',
  'Respect each other. Kindness first.',
];

export default function ConnectingScreen() {
  const router = useRouter();
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
      footer={error ? <PrimaryButton label="Try again" onPress={() => void connect()} /> : undefined}
    >
      <View style={styles.center}>
        {error ? (
          <>
            <Text style={styles.title}>We couldn't connect just yet</Text>
            <Text style={styles.sub}>{error}</Text>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color={colors.brand} />
            <Text style={styles.title}>Finding the right person for you…</Text>
            <Text style={styles.sub}>While you wait, here's what makes Mento a safe space.</Text>
            <View style={styles.list}>
              {GUIDELINES.map((g) => (
                <Text key={g} style={styles.item}>
                  • {g}
                </Text>
              ))}
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', gap: space.md },
  title: { ...type.title, color: colors.ink, textAlign: 'center' },
  sub: { ...type.body, color: colors.inkMuted, textAlign: 'center' },
  list: { gap: space.sm, marginTop: space.lg },
  item: { ...type.body, color: colors.ink },
});

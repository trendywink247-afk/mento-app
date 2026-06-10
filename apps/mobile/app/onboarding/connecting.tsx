import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Fragment, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { ConnectingScene } from '@/components/art/Scenes';
import { ApiError, api } from '@/lib/api';
import { clearDraft, getDraft } from '@/lib/onboardingDraft';
import { saveSession } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

// Guideline copy per mockup #5.
const GUIDELINES: { icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  { icon: 'shield-checkmark-outline', title: 'This is a safe place', body: "We're here to listen and support, without judgment." },
  { icon: 'lock-closed-outline', title: "Don't share personal information", body: 'Keep your identity and details private.' },
  { icon: 'person-outline', title: 'Reflect for better understanding', body: 'Use this space to reflect and grow.' },
  { icon: 'heart-outline', title: 'Be yourself', body: 'Honesty helps build meaningful conversations.' },
  { icon: 'people-outline', title: 'Respect each other', body: "Let's create a kind and respectful space together." },
];

/** Matching screen per mockup #5: two-windows scene, safe-space guideline rows,
 * lavender footer card. The onboarding + match API flow is unchanged. */
export default function ConnectingScreen() {
  const router = useRouter();
  const { colors } = useTheme();
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
      scroll
      footer={error ? <PrimaryButton label="Try again" onPress={() => void connect()} testID="retry" /> : undefined}
    >
      <View style={styles.head}>
        <Text style={[styles.headline, { color: colors.ink }]} accessibilityRole="header">
          {error ? "We couldn't connect just yet" : 'Connecting you to an\navailable mentor…'}
        </Text>
        <Text style={[type.body, styles.center, { color: colors.inkMuted }]}>
          {error ?? "Hang tight! We're finding the right\nperson for you."}
        </Text>
        {error ? (
          <Ionicons name="cloud-offline-outline" size={40} color={colors.inkMuted} />
        ) : (
          <ActivityIndicator size="small" color={colors.accent} />
        )}
      </View>

      {!error ? (
        <>
          <View style={styles.scene}>
            <ConnectingScene width={340} height={170} />
          </View>

          <Text style={[styles.waitTitle, { color: colors.ink }]}>
            While you wait, here's what makes{'\n'}Mento a safe and supportive space.
          </Text>

          <View>
            {GUIDELINES.map((g, i) => (
              <Fragment key={g.title}>
                {i > 0 ? <View style={[styles.divider, { backgroundColor: colors.border }]} /> : null}
                <View style={styles.row}>
                  <IconBadge icon={g.icon} size={48} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.rowTitle, { color: colors.ink }]}>{g.title}</Text>
                    <Text style={[type.caption, { color: colors.inkMuted }]}>{g.body}</Text>
                  </View>
                </View>
              </Fragment>
            ))}
          </View>

          <View style={[styles.footerCard, { backgroundColor: colors.accentTint }]}>
            <Ionicons name="sparkles-outline" size={18} color={colors.accentSoft} />
            <Text style={[styles.footerTitle, { color: colors.ink }]}>
              Let's begin a conversation{'\n'}
              <Text style={{ color: colors.accent }}>that brings you peace of mind.</Text>
            </Text>
            <Text style={[type.body, { color: colors.accent }]}>💜</Text>
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', gap: space.sm, marginTop: space.md, marginBottom: space.md },
  headline: { fontFamily: font.sansHeavy, fontSize: 27, lineHeight: 36, textAlign: 'center' },
  center: { textAlign: 'center' },
  scene: { alignItems: 'center', marginBottom: space.lg },
  waitTitle: {
    fontFamily: font.sansBold,
    fontSize: 18,
    lineHeight: 26,
    textAlign: 'center',
    marginBottom: space.md,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  rowTitle: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 23 },
  divider: { height: 1, marginLeft: 48 + space.md },
  footerCard: {
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.lg,
    padding: space.md,
    marginTop: space.md,
  },
  footerTitle: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 25, textAlign: 'center' },
});

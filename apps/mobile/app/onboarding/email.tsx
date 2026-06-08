import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { setDraft } from '@/lib/onboardingDraft';
import { colors, radius, space, type } from '@/theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const valid = email.length === 0 || EMAIL_RE.test(email);

  const next = (withEmail: boolean) => {
    setDraft({ email: withEmail && email ? email.trim() : null });
    router.push('/onboarding/companion');
  };

  return (
    <Screen
      footer={
        <>
          <PrimaryButton
            label="Continue"
            onPress={() => next(true)}
            disabled={email.length > 0 && !valid}
          />
          <PrimaryButton label="Skip for now" variant="ghost" onPress={() => next(false)} />
        </>
      }
    >
      <View style={styles.iconRow}>
        <Ionicons name="mail-outline" size={22} color={colors.brand} />
        <Text style={styles.title}>Optional, but helpful.</Text>
      </View>
      <Text style={styles.sub}>
        Add an email only if you'd like a way to recover your space later. It's never required and
        never shown to other users.
      </Text>

      <TextInput
        style={styles.input}
        placeholder="Enter your email"
        placeholderTextColor={colors.inkMuted}
        autoCapitalize="none"
        keyboardType="email-address"
        autoCorrect={false}
        value={email}
        onChangeText={setEmail}
      />
      {!valid ? <Text style={styles.err}>That doesn't look like a valid email.</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  iconRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.sm },
  title: { ...type.title, color: colors.ink },
  sub: { ...type.body, color: colors.inkMuted, marginBottom: space.lg },
  input: {
    height: 54,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    ...type.body,
    color: colors.ink,
  },
  err: { ...type.caption, color: colors.danger, marginTop: space.sm },
});

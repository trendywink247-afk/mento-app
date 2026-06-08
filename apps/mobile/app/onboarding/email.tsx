import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { setDraft } from '@/lib/onboardingDraft';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const valid = email.length === 0 || EMAIL_RE.test(email);

  const next = (withEmail: boolean) => {
    setDraft({ email: withEmail && email ? email.trim() : null });
    router.push('/onboarding/companion');
  };

  return (
    <Screen
      onBack={() => router.back()}
      footer={
        <>
          <PrimaryButton
            label="Continue"
            onPress={() => next(true)}
            disabled={email.length > 0 && !valid}
            testID="continue"
          />
          <PrimaryButton label="Skip for now" variant="ghost" onPress={() => next(false)} testID="skip" />
        </>
      }
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.brandTint }]}>
        <Ionicons name="mail-outline" size={24} color={colors.accent} />
      </View>
      <Text style={[type.title, styles.title, { color: colors.ink }]} accessibilityRole="header">
        Optional, but helpful.
      </Text>
      <Text style={[type.body, styles.sub, { color: colors.inkMuted }]}>
        Add an email only if you'd like a way to recover your space later. It's never required and
        never shown to other users.
      </Text>

      <TextInput
        style={[styles.input, { borderColor: valid ? colors.border : colors.danger, color: colors.ink, backgroundColor: colors.surface }]}
        placeholder="Enter your email"
        placeholderTextColor={colors.inkMuted}
        autoCapitalize="none"
        keyboardType="email-address"
        autoCorrect={false}
        value={email}
        onChangeText={setEmail}
        accessibilityLabel="Email address (optional)"
        testID="email-input"
      />
      {!valid ? (
        <Text style={[type.caption, { color: colors.danger, marginTop: space.sm }]}>
          That doesn't look like a valid email.
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.md,
  },
  title: { marginBottom: space.xs },
  sub: { marginBottom: space.lg },
  input: {
    height: 54,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
    ...type.body,
  },
});

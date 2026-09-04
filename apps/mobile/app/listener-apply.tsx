import { useRouter } from 'expo-router';
import { ScrollView, Text } from 'react-native';

import { ApplicationForm } from '@/components/ApplicationForm';
import { Screen } from '@/components/Screen';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

/** Become-a-listener application (spec 2026-07-24), reached from Profile — the
 * member already has a session, so the form submits directly. */
export default function ListenerApply() {
  const router = useRouter();
  const { colors } = useTheme();

  return (
    <Screen onBack={() => router.back()}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: space.xl }}
      >
        <Text style={[type.displaySerif, { color: colors.ink }]} accessibilityRole="header">
          Become a mentor
        </Text>
        <Text style={[type.body, { color: colors.inkMuted, marginTop: space.xs, marginBottom: space.md }]}>
          Mentors are the heart of Mento — people who've been through hard seasons and
          make time to sit with someone in theirs.
        </Text>

        <ApplicationForm onSuccess={() => router.back()} />
      </ScrollView>
    </Screen>
  );
}

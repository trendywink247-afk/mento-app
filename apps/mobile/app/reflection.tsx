import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Panda } from '@/components/art/Panda';
import { capture } from '@/lib/analytics';
import { api } from '@/lib/api';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/**
 * End-of-conversation reflection (mockup #23, SCOPE §8): a private 5-node
 * drained↔energized slider. No points, no XP, skippable via X. Fully decoupled
 * from money (DECISIONS §A.3): every energy level exits back to Chats.
 */
export default function ReflectionScreen() {
  const router = useRouter();
  useSessionGuard();
  const { colors } = useTheme();
  // reason: `listener` stays in the type because EndFlow still routes with ?listener=
  // (deep-link compat); the self-check copy no longer renders it.
  const { conversation } = useLocalSearchParams<{
    conversation?: string;
    listener?: string;
  }>();
  const [energy, setEnergy] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const leave = () => router.replace('/chats');

  const finish = async () => {
    if (!energy || busy) return;
    setBusy(true);
    try {
      if (conversation) await api.saveReflection(conversation, energy);
      // That it happened, never the energy value — reflection is private.
      capture('reflection_submitted');
    } catch {
      // The reflection is private and optional — never block leaving on it.
    }
    leave();
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bgLavender }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable
          onPress={leave}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Skip reflection"
          testID="reflection-skip"
        >
          <Ionicons name="close" size={26} color={colors.ink} />
        </Pressable>
      </View>

      <View style={styles.body}>
        <Text style={[styles.headline, { color: colors.ink }]} accessibilityRole="header">
          Conversation ended
        </Text>
        <Text style={[type.body, styles.center, { color: colors.inkMuted }]}>
          You've taken a thoughtful step today.{'\n'}We hope this space brought you some clarity
          and comfort.
        </Text>

        <View style={styles.art}>
          <Panda pose="wave" size={150} />
        </View>

        <Text style={[styles.question, { color: colors.ink }]}>
          How do you feel right now?
        </Text>
        <Text style={[type.body, styles.center, { color: colors.inkMuted }]}>
          One quiet check-in before you go —{'\n'}no right answers. 💜
        </Text>

        <View style={[styles.sliderCard, { backgroundColor: colors.surface }]}>
          <View style={styles.sliderRow}>
            <Panda pose="sleep" size={52} />
            <View style={styles.track}>
              {[1, 2, 3, 4, 5].map((n) => {
                const selected = energy === n;
                return (
                  <Pressable
                    key={n}
                    onPress={() => setEnergy(n)}
                    hitSlop={12}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={`Energy level ${n} of 5`}
                    testID={`energy-${n}`}
                    style={[
                      styles.node,
                      { backgroundColor: selected ? colors.accent : colors.surfaceAlt },
                      selected && styles.nodeSelected,
                    ]}
                  >
                    {selected ? <Ionicons name="checkmark" size={14} color={colors.onAccent} /> : null}
                  </Pressable>
                );
              })}
            </View>
            <Panda pose="excited" size={52} />
          </View>
          <View style={styles.labels}>
            <Text style={[type.label, { color: colors.ink }]}>Left drained</Text>
            <Text style={[type.label, { color: colors.ink }]}>Left energized</Text>
          </View>
        </View>

        <View style={[styles.privacy, { backgroundColor: colors.surfaceAlt }]}>
          <IconBadge icon="shield-checkmark-outline" size={36} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: colors.ink }]}>Your feedback is private</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              It's only for us and helps improve the support experience.
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.footer}>
        <PrimaryButton
          label="Finish"
          onPress={() => void finish()}
          disabled={!energy}
          loading={busy}
          testID="reflection-finish"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingHorizontal: space.md, paddingTop: space.sm },
  body: { flex: 1, paddingHorizontal: space.lg, gap: space.sm },
  headline: {
    fontFamily: font.sansHeavy,
    fontSize: 28,
    lineHeight: 36,
    textAlign: 'center',
    marginTop: space.xs,
  },
  center: { textAlign: 'center' },
  art: { alignItems: 'center', marginVertical: space.sm },
  question: {
    fontFamily: font.sansHeavy,
    fontSize: 21,
    lineHeight: 28,
    textAlign: 'center',
    marginTop: space.sm,
  },
  sliderCard: { borderRadius: radius.lg, padding: space.md, marginTop: space.md, gap: space.sm },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  track: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xs,
    paddingVertical: space.sm,
  },
  node: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nodeSelected: { width: 32, height: 32, borderRadius: 16 },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.sm,
  },
  footer: { paddingHorizontal: space.lg, paddingBottom: space.md, paddingTop: space.sm },
});

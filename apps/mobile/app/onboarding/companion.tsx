import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { setDraft } from '@/lib/onboardingDraft';
import { useTheme } from '@/theme/ThemeProvider';
import {
  COMPANION_COLOR_LABELS,
  COMPANION_COLORS,
  type CompanionColor,
} from '@/theme/companion';
import { radius, space, type } from '@/theme/tokens';

const ANIMALS = ['Panda', 'Elephant', 'Fox', 'Turtle', 'Deer', 'Owl'];
const COLOR_KEYS = Object.keys(COMPANION_COLORS) as CompanionColor[];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function CompanionScreen() {
  const router = useRouter();
  const { colors, companionColor, setCompanionColor } = useTheme();
  const [animal, setAnimal] = useState<string | null>(null);
  const [colourPicked, setColourPicked] = useState(false);

  const chooseColour = (c: CompanionColor) => {
    setColourPicked(true);
    setCompanionColor(c); // live preview — the whole app re-accents instantly
  };

  const proceed = (a: string) => {
    setDraft({ companionAnimal: a, companionColour: companionColor });
    router.push('/onboarding/connecting');
  };

  const surprise = () => {
    const c = pick(COLOR_KEYS);
    setCompanionColor(c);
    setDraft({ companionAnimal: pick(ANIMALS), companionColour: c });
    router.push('/onboarding/connecting');
  };

  return (
    <Screen
      onBack={() => router.back()}
      scroll
      footer={
        <>
          <PrimaryButton
            label="Continue"
            onPress={() => animal && proceed(animal)}
            disabled={!animal || !colourPicked}
            testID="continue"
          />
          <PrimaryButton label="Surprise me" variant="ghost" onPress={surprise} testID="surprise" />
        </>
      }
    >
      <Text style={[type.title, styles.title, { color: colors.ink }]} accessibilityRole="header">
        Your growth, your theme
      </Text>
      <Text style={[type.body, styles.sub, { color: colors.inkMuted }]}>
        Your journey is represented by an animal and a colour. You can change this later in Profile.
      </Text>

      <Text style={[type.label, styles.step, { color: colors.ink }]}>1 · Choose an animal</Text>
      <View style={styles.grid}>
        {ANIMALS.map((a) => {
          const selected = a === animal;
          return (
            <Pressable
              key={a}
              onPress={() => setAnimal(a)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${a} companion`}
              style={[
                styles.chip,
                { borderColor: colors.border, backgroundColor: colors.surface },
                selected && { backgroundColor: colors.accent, borderColor: colors.accent },
              ]}
            >
              <Text style={[type.label, { color: selected ? colors.onAccent : colors.ink }]}>{a}</Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[type.label, styles.step, { color: colors.ink }]}>2 · Choose a colour</Text>
      <View style={styles.grid}>
        {COLOR_KEYS.map((key) => {
          const selected = colourPicked && key === companionColor;
          const set = COMPANION_COLORS[key];
          return (
            <Pressable
              key={key}
              onPress={() => chooseColour(key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${COMPANION_COLOR_LABELS[key]} theme`}
              style={styles.swatchWrap}
            >
              <View
                style={[
                  styles.swatch,
                  { backgroundColor: set.accent },
                  selected && { borderWidth: 3, borderColor: colors.ink },
                ]}
              >
                {selected ? <Ionicons name="checkmark" size={20} color={set.onAccent} /> : null}
              </View>
              <Text style={[type.caption, { color: colors.inkMuted }]}>
                {COMPANION_COLOR_LABELS[key]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { marginBottom: space.xs },
  sub: { marginBottom: space.lg },
  step: { marginTop: space.md, marginBottom: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  swatchWrap: { alignItems: 'center', gap: space.xs, width: 64 },
  swatch: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

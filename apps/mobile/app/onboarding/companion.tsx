import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { setDraft } from '@/lib/onboardingDraft';
import { colors, radius, space, type } from '@/theme/tokens';

const ANIMALS = ['Panda', 'Elephant', 'Fox', 'Turtle', 'Deer', 'Owl'];
const COLOURS: { name: string; hex: string }[] = [
  { name: 'Purple', hex: '#7C5CFC' },
  { name: 'Blue', hex: '#4C8DFF' },
  { name: 'Green', hex: '#3FB97A' },
  { name: 'Pink', hex: '#F06595' },
  { name: 'Orange', hex: '#F2A65A' },
  { name: 'Teal', hex: '#2CB4A6' },
  { name: 'Indigo', hex: '#5B4FE3' },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export default function CompanionScreen() {
  const router = useRouter();
  const [animal, setAnimal] = useState<string | null>(null);
  const [colour, setColour] = useState<string | null>(null);

  const proceed = (a: string, c: string) => {
    setDraft({ companionAnimal: a, companionColour: c });
    router.push('/onboarding/connecting');
  };

  return (
    <Screen
      footer={
        <>
          <PrimaryButton
            label="Continue"
            onPress={() => animal && colour && proceed(animal, colour)}
            disabled={!animal || !colour}
          />
          <PrimaryButton
            label="Surprise me"
            variant="ghost"
            onPress={() => proceed(pick(ANIMALS), pick(COLOURS).name)}
          />
        </>
      }
    >
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Your growth, your theme</Text>
        <Text style={styles.sub}>
          Your journey is represented by an animal and a colour. You can change this later.
        </Text>

        <Text style={styles.step}>1 · Choose an animal</Text>
        <View style={styles.grid}>
          {ANIMALS.map((a) => {
            const selected = a === animal;
            return (
              <Pressable
                key={a}
                onPress={() => setAnimal(a)}
                style={[styles.chip, selected && styles.chipOn]}
              >
                <Text style={[type.label, { color: selected ? colors.onBrand : colors.ink }]}>
                  {a}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.step}>2 · Choose a colour</Text>
        <View style={styles.grid}>
          {COLOURS.map((c) => {
            const selected = c.name === colour;
            return (
              <Pressable key={c.name} onPress={() => setColour(c.name)} style={styles.swatchWrap}>
                <View style={[styles.swatch, { backgroundColor: c.hex }]}>
                  {selected ? <Ionicons name="checkmark" size={18} color="#fff" /> : null}
                </View>
                <Text style={type.caption}>{c.name}</Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { ...type.title, color: colors.ink, marginBottom: space.sm },
  sub: { ...type.body, color: colors.inkMuted, marginBottom: space.lg },
  step: { ...type.label, color: colors.ink, marginBottom: space.sm, marginTop: space.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  swatchWrap: { alignItems: 'center', gap: space.xs, width: 64 },
  swatch: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

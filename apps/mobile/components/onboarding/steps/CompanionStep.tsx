import { Ionicons } from '@expo/vector-icons';
import { type ReactNode, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Entrance } from '@/components/motion/Entrance';
import { useBreathing } from '@/components/motion/useBreathing';
import { StepScaffold } from '@/components/onboarding/StepScaffold';
import { Companion, type CompanionTrigger } from '@/components/art/Companion';
import { type CompanionAnimal } from '@/components/art/Companions';
import { capture } from '@/lib/analytics';
import { haptic } from '@/lib/haptics';
import { useI18n } from '@/lib/i18n';
import { getDraft, setDraft } from '@/lib/onboardingDraft';
import { useTheme } from '@/theme/ThemeProvider';
import {
  COMPANION_COLOR_LABELS,
  COMPANION_COLORS,
  type CompanionColor,
} from '@/theme/companion';
import { font, radius, space, type } from '@/theme/tokens';

const ANIMALS: CompanionAnimal[] = [
  'Panda',
  'Dog',
  'Cat',
  'Fox',
  'Capybara',
  'Elephant',
  'Turtle',
  'Deer',
  'Owl',
];
const COLOR_KEYS = Object.keys(COMPANION_COLORS) as CompanionColor[];

/** The picked companion breathes (the rail's other animals only micro-sway) — a quiet
 * sign of life on the one you chose. Transform-only; useBreathing stills it under
 * reduced motion. */
function Breathe({ on, children }: { on: boolean; children: ReactNode }) {
  const breathing = useBreathing(on);
  return <Animated.View style={breathing}>{children}</Animated.View>;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Growth-companion picker per mockup #58 (body unchanged from the old route).
 * Picking a colour live re-accents the whole app — the signature moment. Picking an
 * animal makes it the star: the journey's stage swaps to it live (DECISIONS §I.5). */
export function CompanionStep({
  onNext,
  onAnimalPicked,
}: {
  onNext: () => void;
  onAnimalPicked?: (animal: CompanionAnimal) => void;
}) {
  const { colors, companionColor, setCompanionColor } = useTheme();
  const { t } = useI18n();
  const draft = getDraft();
  const [animal, setAnimal] = useState<CompanionAnimal | null>(
    (draft.companionAnimal as CompanionAnimal | null) ?? null
  );
  const [colourPicked, setColourPicked] = useState(!!draft.companionColour);
  // The picked animal greets — a tiny hello at the moment of choice.
  const [greet, setGreet] = useState<CompanionTrigger>(null);

  const chooseColour = (c: CompanionColor) => {
    haptic.tick();
    setColourPicked(true);
    setCompanionColor(c); // live preview — the whole app re-accents instantly
  };

  const chooseAnimal = (a: CompanionAnimal) => {
    haptic.tick();
    setAnimal(a);
    setGreet((t) => ({ kind: 'greet', n: (t?.n ?? 0) + 1 }));
    onAnimalPicked?.(a);
  };

  const onContinue = () => {
    if (!animal || !colourPicked) return;
    setDraft({ companionAnimal: animal, companionColour: companionColor });
    capture('onboarding_companion_chosen', { companion: animal });
    onNext();
  };

  // Surprise picks a visible selection (and re-accents live) — the user still confirms
  // with Continue, so the choice never feels taken away.
  const surprise = () => {
    const a = pick(ANIMALS);
    setAnimal(a);
    onAnimalPicked?.(a);
    chooseColour(pick(COLOR_KEYS));
  };

  const checkBadge = (
    <View style={[styles.check, { backgroundColor: colors.accent }]}>
      <Ionicons name="checkmark" size={14} color={colors.onAccent} />
    </View>
  );

  return (
    <StepScaffold
      footerIndex={4}
      footer={
        <>
          <PrimaryButton
            label={t('common.continue')}
            trailing="chevron"
            onPress={onContinue}
            disabled={!animal || !colourPicked}
            testID="continue"
          />
          <View style={styles.lockRow}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.inkMuted} />
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              {t('onboarding.companion.changeLater')}
            </Text>
          </View>
        </>
      }
    >
      <Entrance index={0}>
        <View style={styles.head}>
          <IconBadge icon="color-palette-outline" size={56} />
          <Text style={[styles.headline, { color: colors.ink }]} accessibilityRole="header">
            {t('onboarding.companion.headline')}
          </Text>
          <Text style={[type.body, styles.center, { color: colors.inkMuted }]}>
            {t('onboarding.companion.sub')}
          </Text>
        </View>
      </Entrance>

      <Entrance index={1}>
      <View style={styles.section}>
        <IconBadge icon="paw-outline" size={44} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.stepTitle, { color: colors.ink }]}>{t('onboarding.companion.step1')}</Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>
            {t('onboarding.companion.step1Sub')}
          </Text>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
      >
        {ANIMALS.map((a) => {
          const selected = a === animal;
          return (
            <Pressable
              key={a}
              onPress={() => chooseAnimal(a)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={t('onboarding.companion.animalA11y', { animal: a })}
              testID={`animal-${a.toLowerCase()}`}
              style={styles.cell}
            >
              <View
                style={[
                  styles.animalCard,
                  { backgroundColor: colors.surface },
                  selected && { borderWidth: 2, borderColor: colors.accent },
                ]}
              >
                <Breathe on={selected}>
                  <Companion animal={a} size={76} trigger={selected ? greet : null} awake />
                </Breathe>
                {selected ? checkBadge : null}
              </View>
              <Text
                style={[
                  type.label,
                  { color: selected ? colors.accent : colors.ink },
                  !selected && { fontFamily: font.sansSemi },
                ]}
              >
                {a}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      </Entrance>

      <Entrance index={2}>
      <View style={styles.section}>
        <IconBadge icon="water-outline" size={44} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.stepTitle, { color: colors.ink }]}>{t('onboarding.companion.step2')}</Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>
            {t('onboarding.companion.step2Sub')}
          </Text>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.rail}
      >
        {COLOR_KEYS.map((key) => {
          const selected = colourPicked && key === companionColor;
          const set = COMPANION_COLORS[key];
          return (
            <Pressable
              key={key}
              onPress={() => chooseColour(key)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={t('onboarding.companion.themeA11y', { label: COMPANION_COLOR_LABELS[key] })}
              testID={`colour-${key}`}
              style={styles.cell}
            >
              <View
                style={[
                  styles.colourCard,
                  { backgroundColor: colors.surface },
                  selected && { borderWidth: 2, borderColor: colors.accent },
                ]}
              >
                <View style={[styles.dot, { backgroundColor: set.accent }]} />
                {selected ? checkBadge : null}
              </View>
              <Text
                style={[
                  type.label,
                  { color: selected ? colors.accent : colors.ink },
                  !selected && { fontFamily: font.sansSemi },
                ]}
              >
                {COMPANION_COLOR_LABELS[key]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      </Entrance>

      <Entrance index={3}>
      <View style={[styles.decideCard, { backgroundColor: colors.surface }]}>
        <IconBadge icon="sparkles-outline" size={44} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.decideTitle, { color: colors.ink }]}>{t('onboarding.companion.decideTitle')}</Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>
            {t('onboarding.companion.decideSub')}
          </Text>
        </View>
        <Pressable
          onPress={surprise}
          accessibilityRole="button"
          accessibilityLabel={t('onboarding.companion.surpriseA11y')}
          testID="surprise"
          style={[styles.outlineBtn, { borderColor: colors.accent }]}
        >
          <Ionicons name="shuffle-outline" size={16} color={colors.accent} />
          <Text style={[type.label, { color: colors.accent }]}>{t('onboarding.companion.surprise')}</Text>
        </Pressable>
      </View>
      </Entrance>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', gap: space.sm, marginBottom: space.md },
  headline: { ...type.displayHeadline, textAlign: 'center' },
  center: { textAlign: 'center' },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.sm,
    marginBottom: space.sm,
  },
  stepTitle: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 24 },
  rail: { gap: space.sm, paddingVertical: space.xs, paddingRight: space.lg },
  cell: { alignItems: 'center', gap: space.xs },
  animalCard: {
    width: 96,
    height: 96,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  colourCard: {
    width: 76,
    height: 76,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 44, height: 44, borderRadius: radius.pill },
  check: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  decideCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.md,
    marginTop: space.md,
  },
  decideTitle: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 22 },
  outlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderWidth: 1.5,
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    paddingHorizontal: space.sm + space.xs,
  },
  lockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    marginTop: space.xs,
  },
});

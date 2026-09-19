import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { useBreathing } from '@/components/motion/useBreathing';
import { CompanionNameField } from '@/components/onboarding/CompanionNameField';
import { StepScaffold } from '@/components/onboarding/StepScaffold';
import { Companion, type CompanionPose, type CompanionTrigger } from '@/components/art/Companion';
import { type CompanionAnimal } from '@/components/art/Companions';
import { capture } from '@/lib/analytics';
import { checkCompanionName } from '@/lib/companionName';
import { haptic } from '@/lib/haptics';
import { useI18n } from '@/lib/i18n';
import { getDraft, setDraft } from '@/lib/onboardingDraft';
import { useFrameSize } from '@/lib/useFrameSize';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { useTheme } from '@/theme/ThemeProvider';
import {
  COMPANION_COLOR_LABELS,
  COMPANION_COLORS,
  type CompanionColor,
} from '@/theme/companion';
import { radius, space, type } from '@/theme/tokens';

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

/** Board A03 metrics. The tile is 96 tall on the board's 844 canvas; with the journey's
 * header above it a shorter phone gets a slightly shallower tile rather than a scroll. */
const TILE_MAX = 96;
const TILE_MIN = 80;
const HERO_W = 104;
const HERO_H = 132;
const HERO_ART = 124;
const SWATCH_MAX = 44;
/** The least air between two colour keys — a narrow phone gets smaller keys, not touching ones. */
const SWATCH_GAP_MIN = 8;
/** Everything on the step that is not the three tile rows (header, copy, swatches, keys). */
const CHROME = 600;
/** Air above the optional name row (founder ruling 2026-09-19). The row is not part of the
 * resting screen — it arrives under the colours once there is a companion to name. */
const NAME_GAP = 10;
/** The hero's pose swap (board: idle for ~5s, a wave for ~2.8s, on a 9s loop). Cadences,
 * not animation durations — the crossfade itself is the Companion's own token timing. */
const POSE_LOOP_MS = 9000;
const POSE_WAVE_AT_MS = 5600;
const POSE_WAVE_FOR_MS = 2800;

/** A quiet sign of life on the hero and on the tile you picked. Transform-only, from the
 * feet; useBreathing stills it under reduced motion. */
function Breathe({ on, children }: { on: boolean; children: ReactNode }) {
  const breathing = useBreathing(on);
  return <Animated.View style={[styles.originBottom, breathing]}>{children}</Animated.View>;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Growth-companion picker — board A03: the hero companion beside the headline (breathing,
 * waving now and then), a 3×3 grid of pillow tiles with the picked one in the accent, the
 * seven colour keys, "Surprise Me" + "Continue". Picking a colour live re-accents the
 * whole app — the signature moment. Picking an animal makes it the star (DECISIONS §I.5). */
export function CompanionStep({
  onNext,
  onAnimalPicked,
}: {
  onNext: () => void;
  onAnimalPicked?: (animal: CompanionAnimal) => void;
}) {
  const { colors, companionColor, setCompanionColor } = useTheme();
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width, height } = useFrameSize();
  const draft = getDraft();
  const [animal, setAnimal] = useState<CompanionAnimal | null>(
    (draft.companionAnimal as CompanionAnimal | null) ?? null
  );
  const [colourPicked, setColourPicked] = useState(!!draft.companionColour);
  // The companion's name — optional; skipping never blocks Continue. Only a name the
  // server would refuse (a link, an email, a phone number) holds the key back.
  const [name, setName] = useState(draft.companionName ?? '');
  const nameCheck = checkCompanionName(name);
  const nameInvalid = nameCheck.state === 'invalid';

  // The name row arrives once both required choices are made — there is a companion to
  // name, and the resting screen stays the board's A03. When it (or its still error line)
  // lays out, the step glides to its end so it is in view: on a phone where the step
  // scrolls it would otherwise land below the fold unseen. A no-op when everything fits.
  const showName = Boolean(animal) && colourPicked;
  const scrollRef = useRef<ScrollView>(null);
  const revealName = () => scrollRef.current?.scrollToEnd({ animated: !reduced });
  // The picked animal greets — a tiny hello at the moment of choice.
  const [greet, setGreet] = useState<CompanionTrigger>(null);

  // The hero waves now and then (pinned pose; the Companion crossfades it).
  const [heroPose, setHeroPose] = useState<CompanionPose | undefined>(undefined);
  useEffect(() => {
    if (reduced) {
      setHeroPose(undefined);
      return;
    }
    let off: ReturnType<typeof setTimeout> | undefined;
    const wave = () => {
      setHeroPose('greet');
      off = setTimeout(() => setHeroPose(undefined), POSE_WAVE_FOR_MS);
    };
    const first = setTimeout(wave, POSE_WAVE_AT_MS);
    const loop = setInterval(wave, POSE_LOOP_MS);
    return () => {
      clearTimeout(first);
      clearInterval(loop);
      if (off) clearTimeout(off);
    };
  }, [reduced]);

  const tileH = Math.max(TILE_MIN, Math.min(TILE_MAX, Math.floor((height - insets.top - insets.bottom - CHROME) / 3)));
  const artH = tileH - 32;
  const swatch = Math.min(
    SWATCH_MAX,
    Math.floor((width - space.lg * 2 - 4 - SWATCH_GAP_MIN * (COLOR_KEYS.length - 1)) / COLOR_KEYS.length)
  );

  const applyColour = (c: CompanionColor) => {
    setColourPicked(true);
    setCompanionColor(c); // live preview — the whole app re-accents instantly
  };
  // One press, one haptic: the swatch key is silent and the choice ticks here; Surprise
  // already buzzed as a key, so it applies the colour without a second one.
  const chooseColour = (c: CompanionColor) => {
    haptic.tick();
    applyColour(c);
  };

  const chooseAnimal = (a: CompanionAnimal) => {
    setAnimal(a);
    setGreet((g) => ({ kind: 'greet', n: (g?.n ?? 0) + 1 }));
    onAnimalPicked?.(a);
  };

  const onContinue = () => {
    if (!animal || !colourPicked || nameInvalid) return;
    setDraft({
      companionAnimal: animal,
      companionColour: companionColor,
      companionName: nameCheck.state === 'ok' ? nameCheck.name : null,
    });
    // The animal only — the name is the member's own and never goes to analytics.
    capture('onboarding_companion_chosen', { companion: animal });
    Keyboard.dismiss();
    onNext();
  };

  // Surprise picks a visible selection (and re-accents live) — the user still confirms
  // with Continue, so the choice never feels taken away.
  const surprise = () => {
    const a = pick(ANIMALS);
    setAnimal(a);
    onAnimalPicked?.(a);
    applyColour(pick(COLOR_KEYS));
  };

  return (
    <StepScaffold
      footerIndex={4}
      scrollRef={scrollRef}
      footer={
        <>
          <View style={styles.keys}>
            <View style={styles.surpriseCell}>
              <PrimaryButton
                label={t('onboarding.companion.surprise')}
                variant="surface"
                shape="key"
                dense
                icon="sparkles-outline"
                onPress={surprise}
                accessibilityLabel={t('onboarding.companion.surpriseA11y')}
                testID="surprise"
              />
            </View>
            <View style={styles.continueCell}>
              <PrimaryButton
                label={t('common.continue')}
                shape="key"
                onPress={onContinue}
                disabled={!animal || !colourPicked || nameInvalid}
                testID="continue"
              />
            </View>
          </View>
          <Text style={[type.caption, styles.changeLater, { color: colors.inkMuted }]}>
            {t('onboarding.companion.changeLater')}
          </Text>
        </>
      }
    >
      <Entrance index={1} style={styles.head}>
        <View style={styles.headText}>
          <Text style={[type.displayHeadline, { color: colors.ink }]} accessibilityRole="header">
            {t('onboarding.companion.headline')}
            <Text style={{ color: colors.accent }}>{t('onboarding.companion.headlineAccent')}</Text>
          </Text>
          <Text style={[type.bodySmall, { color: colors.inkMuted }]}>{t('onboarding.companion.sub')}</Text>
        </View>
        <View
          style={styles.hero}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('onboarding.companion.heroA11y', { animal: animal ?? 'Panda' })}
        >
          <View style={[styles.heroShelf, { backgroundColor: colors.edgeSurface }]} />
          <View style={styles.heroArt}>
            <Breathe on>
              <Companion animal={animal} size={HERO_ART} pose={heroPose} trigger={greet} awake />
            </Breathe>
          </View>
        </View>
      </Entrance>

      <Entrance index={2} style={styles.section}>
        <View>
          <Text style={[type.bodySemi, styles.sectionTitle, { color: colors.ink }]}>
            {t('onboarding.companion.step1')}
          </Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>{t('onboarding.companion.step1Sub')}</Text>
        </View>
        <View style={styles.grid}>
          {ANIMALS.map((a) => {
            const selected = a === animal;
            return (
              <PressKey
                key={a}
                onPress={() => chooseAnimal(a)}
                edge={selected ? colors.accentEdge : colors.edgeSurface}
                travel={4}
                intent="select"
                radius={radius.lg}
                accessibilityState={{ selected }}
                accessibilityLabel={t('onboarding.companion.animalA11y', { animal: a })}
                testID={`animal-${a.toLowerCase()}`}
                containerStyle={styles.cell}
                style={[
                  styles.tile,
                  { height: tileH },
                  selected
                    ? { backgroundColor: colors.accentTint, borderWidth: 2, borderColor: colors.accent }
                    : { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
                ]}
              >
                <Breathe on={selected}>
                  <Companion animal={a} size={artH} awake />
                </Breathe>
                {/* accentEdge, not accent: a 14px label on the tint face needs 4.5:1 (contrast gate). */}
                <Text style={[type.label, { color: selected ? colors.accentEdge : colors.ink }]} numberOfLines={1}>
                  {a}
                </Text>
              </PressKey>
            );
          })}
        </View>
      </Entrance>

      <Entrance index={3} style={styles.section}>
        <View>
          <Text style={[type.bodySemi, styles.sectionTitle, { color: colors.ink }]}>
            {t('onboarding.companion.step2')}
          </Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>{t('onboarding.companion.step2Sub')}</Text>
        </View>
        <View style={styles.swatches}>
          {COLOR_KEYS.map((key) => {
            const selected = colourPicked && key === companionColor;
            const set = COMPANION_COLORS[key];
            return (
              <View key={key} style={{ width: swatch, alignItems: 'center' }}>
                {/* The picked colour trades its pillow edge for a ring (board): it reads
                  * as pressed in and held. The ring floats, so nothing shifts. */}
                {selected ? (
                  <View
                    style={[styles.ring, { width: swatch + 10, height: swatch + 10, borderColor: colors.ink }]}
                    pointerEvents="none"
                  />
                ) : null}
                <PressKey
                  onPress={() => chooseColour(key)}
                  edge={selected ? 'transparent' : set.accentEdge}
                  travel={4}
                  intent="select"
                  haptic="none"
                  radius={radius.pill}
                  accessibilityState={{ selected }}
                  accessibilityLabel={t('onboarding.companion.themeA11y', { label: COMPANION_COLOR_LABELS[key] })}
                  testID={`colour-${key}`}
                  style={{ width: swatch, height: swatch, backgroundColor: set.accent }}
                >
                  {null}
                </PressKey>
              </View>
            );
          })}
        </View>
      </Entrance>

      {showName ? (
        <View style={styles.nameBlock} onLayout={revealName}>
          <Entrance>
            <CompanionNameField
              value={name}
              onChangeText={setName}
              animal={animal}
              invalid={nameInvalid}
              onSubmitEditing={() => Keyboard.dismiss()}
            />
          </Entrance>
          {/* Still, plain words — nothing shakes (T&S #11). */}
          {nameInvalid ? (
            <Text style={[type.caption, { color: colors.danger }]} testID="companion-name-invalid">
              {t('onboarding.companionName.invalid')}
            </Text>
          ) : null}
        </View>
      ) : null}
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  originBottom: { transformOrigin: 'bottom' },
  head: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  headText: { flex: 1, gap: 6 },
  hero: { width: HERO_W, height: HERO_H },
  heroShelf: { position: 'absolute', left: 8, right: 8, bottom: 0, height: 22, borderRadius: radius.pill },
  heroArt: { position: 'absolute', left: (HERO_W - HERO_ART) / 2, bottom: 8, width: HERO_ART, height: HERO_ART },
  section: { gap: 10, marginTop: 18 },
  sectionTitle: { lineHeight: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 12 },
  // Three across: (100% − 2 gaps) / 3, as a basis so the keys share the row exactly.
  cell: { flexBasis: '30%', flexGrow: 1, maxWidth: '33.4%' },
  tile: { alignItems: 'center', justifyContent: 'flex-end', paddingTop: 6, paddingBottom: 4, paddingHorizontal: 4 },
  swatches: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2, paddingTop: 4, paddingBottom: space.sm },
  ring: {
    position: 'absolute',
    left: -5,
    top: -5,
    borderRadius: radius.pill,
    borderWidth: 2,
  },
  nameBlock: { marginTop: NAME_GAP, gap: 6 },
  keys: { flexDirection: 'row', gap: 12 },
  surpriseCell: { flex: 1 },
  continueCell: { flex: 1.3 },
  changeLater: { textAlign: 'center', marginTop: space.sm },
});

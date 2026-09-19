/**
 * MentorFace — the ONE way a mentor is drawn, on every screen (board A04 / A05 / A06 / A10 /
 * A14 / A25 / A35): their companion animal standing in a soft round wash disc, with an
 * optional presence dot. Never a face, a photo, a landscape or a badge.
 *
 * Which animal and which wash come from the SERVER (`companion_animal` / `companion_colour`
 * on every mentor payload — `services/api/app/services/mentor_face.py`). They are dealt
 * once from the listener id and never rotate with the daily name ("same owl, new name",
 * DECISIONS §L.6 l). The client never derives a mentor's look on its own: before a payload
 * has arrived the caller passes what `lib/mentorFaces` remembers, and with nothing at all
 * the disc shows the board's default mentor, the Owl on sage.
 */
import { Image, StyleSheet, View } from 'react-native';

import { COMPANION_GENERATED } from '@/assets/companions/generated';
import type { CompanionAnimal } from '@/components/art/Companions';
import { useTheme } from '@/theme/ThemeProvider';
import { accentFor } from '@/theme/companion';
import { radius } from '@/theme/tokens';

export const DEFAULT_MENTOR_ANIMAL: CompanionAnimal = 'Owl';
export const DEFAULT_MENTOR_COLOUR = 'sage';

export type MentorLook = { animal?: string | null; colour?: string | null };

function artFor(animal: string | null | undefined) {
  const key = (animal ?? DEFAULT_MENTOR_ANIMAL) as CompanionAnimal;
  return (COMPANION_GENERATED[key] ?? COMPANION_GENERATED[DEFAULT_MENTOR_ANIMAL]).poses.idle;
}

/** The wash behind a mentor: the pale tint of their companion colour (board: sage
 * `#DCE6DD`, mustard `#F5E8C4`, …) — never the viewer's accent. */
export function mentorWash(colour: string | null | undefined): string {
  return accentFor(colour ?? DEFAULT_MENTOR_COLOUR).accentTint;
}

export function MentorFace({
  animal,
  colour,
  size = 52,
  presence,
  testID,
}: MentorLook & {
  size?: number;
  /** `true` here now · `false` away · undefined = unknown, no dot (never assumed). */
  presence?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const art = Math.round(size * 0.92);
  const dot = Math.max(12, Math.round(size * 0.27));
  const shown = animal ?? DEFAULT_MENTOR_ANIMAL;

  return (
    <View
      style={{ width: size, height: size }}
      testID={testID}
      // Decorative for assistive tech — the name beside it is what is read.
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {/* The disc's testID names the animal: the e2e proof that one mentor wears one face
          on every screen (e2e/mentor-face.e2e.js). */}
      <View
        testID={`face-mentor-${shown}`}
        style={[styles.disc, { width: size, height: size, backgroundColor: mentorWash(colour) }]}
      >
        {/* reason: a STILL of the idle painting, not the Companion rig — a list of ten rigs
            would be ten idle movers (motion budget: three). The mentor is not the member's
            companion; it never reacts. */}
        <Image
          source={artFor(animal)}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          style={{ width: art, height: art }}
        />
      </View>
      {presence !== undefined ? (
        <View
          testID="presence-dot"
          style={[
            styles.dot,
            {
              width: dot,
              height: dot,
              backgroundColor: presence ? colors.success : colors.dotIdle,
              borderColor: colors.surface,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

/** The same mentor as a whole figure, standing free (board A14's hero, A04's letter). A
 * still painting; the caller decides whether it breathes. */
export function MentorFaceFigure({
  animal,
  width,
  height,
}: {
  animal?: string | null;
  width: number;
  height: number;
}) {
  const shown = animal ?? DEFAULT_MENTOR_ANIMAL;
  return (
    <View testID={`face-mentor-${shown}`} style={{ width, height }}>
      <Image source={artFor(animal)} resizeMode="contain" accessibilityIgnoresInvertColors style={{ width, height }} />
    </View>
  );
}

const styles = StyleSheet.create({
  disc: { borderRadius: radius.pill, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end' },
  dot: { position: 'absolute', right: -1, bottom: -1, borderRadius: radius.pill, borderWidth: 2 },
});

/**
 * MentorAvatar — how a mentor appears to a member everywhere outside the chat bubbles
 * (board A06 / A14 / A25): a companion animal standing in a soft round wash disc, with an
 * optional presence dot. Never a face, a photo or a badge.
 *
 * Which animal and which wash come from `seed` — the mentor's `persona_avatar`, which the
 * server keeps STABLE while the persona name rotates every day ("same owl, new name",
 * DECISIONS §L.6). Never key this on the name.
 */
import { Image, StyleSheet, View } from 'react-native';

import { COMPANION_GENERATED } from '@/assets/companions/generated';
import type { CompanionAnimal } from '@/components/art/Companions';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, wash, type Wash } from '@/theme/tokens';

const ANIMALS: CompanionAnimal[] = ['Owl', 'Fox', 'Deer', 'Turtle', 'Elephant', 'Capybara', 'Dog', 'Panda', 'Cat'];
const WASHES: Wash[] = ['green', 'sky', 'orange', 'indigo'];

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function mentorLook(seed: string): { animal: CompanionAnimal; wash: Wash } {
  const h = hash(seed || 'mento');
  return { animal: ANIMALS[h % ANIMALS.length], wash: WASHES[(h >>> 4) % WASHES.length] };
}

export function MentorAvatar({
  seed,
  size = 52,
  presence,
  testID,
}: {
  seed: string;
  size?: number;
  /** `true` here now · `false` away · undefined = unknown, no dot (never assumed). */
  presence?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const look = mentorLook(seed);
  const set = COMPANION_GENERATED[look.animal] ?? COMPANION_GENERATED.Panda;
  const art = Math.round(size * 0.92);
  const dot = Math.max(12, Math.round(size * 0.27));

  return (
    <View style={{ width: size, height: size }} testID={testID}>
      <View style={[styles.disc, { width: size, height: size, backgroundColor: wash[look.wash] }]}>
        {/* reason: a STILL of the idle painting, not the Companion rig — a list of ten rigs
            would be ten idle movers (motion budget: three). The mentor is not the member's
            companion; it never reacts. */}
        <Image
          source={set.poses.idle}
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

const styles = StyleSheet.create({
  disc: { borderRadius: radius.pill, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end' },
  dot: { position: 'absolute', right: -1, bottom: -1, borderRadius: radius.pill, borderWidth: 2 },
});

/**
 * The mentor's companion over the message field (board A35) — shared by the native and web
 * mentor chats. It lives in a zero-height band just above the footer, and is seated by its
 * OWN art: an animal with a `peek` painting puts that painting's paw line on the footer's
 * top edge (the board's "peeking over the message field"); an animal without one (the Owl,
 * the mentors' default) stands its whole figure on the edge, feet on the line — never sunk
 * into the footer, which is what cut it off at the chest before.
 *
 * Decorative; the one idle mover here (breathing), still under reduced motion.
 */
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { COMPANION_GENERATED } from '@/assets/companions/generated';
import { Companion } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { useBreathing } from '@/components/motion/useBreathing';
import { space } from '@/theme/tokens';

const HEIGHT = 90;

/** How far below the footer's top edge the figure's bottom sits, so its paws / feet land on
 * the edge. 0 when the art stands on its own bottom. */
function seat(animal: CompanionAnimal): { pose: 'peek' | 'idle'; sink: number } {
  const set = COMPANION_GENERATED[animal];
  if (set?.poses.peek) {
    return { pose: 'peek', sink: Math.round(HEIGHT * (1 - (set.contact?.peek ?? 1))) };
  }
  return { pose: 'idle', sink: Math.round(HEIGHT * (1 - (set?.ground ?? 1))) };
}

/** The room the thread keeps free at its foot so the last bubble never sits behind the
 * companion (the member chat's `companionRoom` rule, applied to the mentor side). */
export function mentorPeekRoom(animal: CompanionAnimal | null): number {
  if (!animal) return space.sm;
  return HEIGHT - seat(animal).sink + space.xs;
}

export function MentorPeek({ animal, label }: { animal: CompanionAnimal | null; label: string }) {
  const breathing = useBreathing();
  if (!animal) return <View style={styles.zone} />;
  const { pose, sink } = seat(animal);
  return (
    <View style={styles.zone} pointerEvents="none">
      <View
        style={[styles.peek, { bottom: -sink }]}
        pointerEvents="none"
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        testID={`self-mentor-${animal}`}
      >
        <Animated.View style={[styles.originBottom, breathing]}>
          <Companion animal={animal} size={HEIGHT} pose={pose} awake />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  zone: { height: 0, zIndex: 0 },
  peek: { position: 'absolute', right: 22, height: HEIGHT, alignItems: 'center', justifyContent: 'flex-end' },
  originBottom: { transformOrigin: 'bottom' },
});

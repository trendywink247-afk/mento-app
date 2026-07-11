/**
 * Companion — THE single entry point for rendering the growth companion anywhere
 * (onboarding stage, ready arch, profile). Asset strategy is hidden inside
 * (DECISIONS §I.4 amended): the in-house ReactiveCompanion rig is the v1 route;
 * a Lottie file from assets/companions/registry.ts takes over per-animal when
 * dropped in; a commissioned Rive set can replace the internals later — call
 * sites never change.
 *
 * State vocabulary (all animals): idle micro-sway (+ host breathing), greet,
 * celebrate, comfort, tap-react (`interactive`). The panda's bespoke layered rig
 * (blink + waving arm) rides inside the same wrapper.
 */
import LottieView from 'lottie-react-native';

import { COMPANION_LOTTIE } from '@/assets/companions/registry';
import { AnimatedPanda } from '@/components/art/AnimatedPanda';
import { CompanionArt, type CompanionAnimal } from '@/components/art/Companions';
import { ReactiveCompanion, type CompanionTrigger } from '@/components/art/ReactiveCompanion';
import { useReducedMotion } from '@/lib/useReducedMotion';

export type { CompanionTrigger };

export function Companion({
  animal,
  size = 72,
  waveTrigger = 0,
  trigger = null,
  interactive = false,
  onPress,
}: {
  /** null = no choice yet — the panda greets as the brand guide. */
  animal: CompanionAnimal | null;
  size?: number;
  /** Panda-only bonus: bump to wave the arm (rides on top of the rig states). */
  waveTrigger?: number;
  /** Play a state: {kind: 'greet'|'celebrate'|'comfort', n}. */
  trigger?: CompanionTrigger;
  /** Tap-react acknowledgement (wraps in a Pressable). */
  interactive?: boolean;
  onPress?: () => void;
}) {
  const reduced = useReducedMotion();
  const resolved = animal ?? 'Panda';
  const source = COMPANION_LOTTIE[resolved];

  const art = source ? (
    <LottieView
      source={source}
      autoPlay={!reduced}
      loop={!reduced}
      style={{ width: size, height: size }}
    />
  ) : resolved === 'Panda' ? (
    <AnimatedPanda size={size} waveTrigger={waveTrigger} />
  ) : (
    <CompanionArt animal={resolved} size={size} />
  );

  return (
    <ReactiveCompanion size={size} trigger={trigger} interactive={interactive} onPress={onPress}>
      {art}
    </ReactiveCompanion>
  );
}

/**
 * Companion — THE single entry point for rendering the growth companion anywhere
 * (onboarding stage, ready arch, profile). Asset strategy is hidden inside
 * (DECISIONS §I.4): Lottie interim today, commissioned Rive characters later —
 * call sites never change.
 *
 * Resolution order per animal:
 *  1. Lottie loop from assets/companions/registry.ts (when the file has been dropped in)
 *  2. Fallback: the coded SVG art — AnimatedPanda rig for the panda, static
 *     CompanionArt for the others (hosts add breathing where it fits).
 * Reduced motion: Lottie holds its first frame instead of looping.
 */
import LottieView from 'lottie-react-native';

import { COMPANION_LOTTIE } from '@/assets/companions/registry';
import { AnimatedPanda } from '@/components/art/AnimatedPanda';
import { CompanionArt, type CompanionAnimal } from '@/components/art/Companions';
import { useReducedMotion } from '@/lib/useReducedMotion';

export function Companion({
  animal,
  size = 72,
  waveTrigger = 0,
}: {
  /** null = no choice yet — the panda greets as the brand guide. */
  animal: CompanionAnimal | null;
  size?: number;
  /** Bump to wave (SVG panda rig only; Lottie/Rive handle greeting internally). */
  waveTrigger?: number;
}) {
  const reduced = useReducedMotion();
  const resolved = animal ?? 'Panda';
  const source = COMPANION_LOTTIE[resolved];

  if (source) {
    return (
      <LottieView
        source={source}
        autoPlay={!reduced}
        loop={!reduced}
        style={{ width: size, height: size }}
      />
    );
  }
  if (resolved === 'Panda') return <AnimatedPanda size={size} waveTrigger={waveTrigger} />;
  return <CompanionArt animal={resolved} size={size} />;
}

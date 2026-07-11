/**
 * Companion — THE single entry point for rendering the growth companion anywhere
 * (onboarding stage, ready arch, profile). Asset strategy is hidden inside
 * (DECISIONS §I.4 amended): Fluent Emoji Color art (MIT, one consistent style
 * across all six) on the in-house ReactiveCompanion rig is the v1 route; a
 * Lottie file from assets/companions/registry.ts overrides per-animal when
 * dropped in; a commissioned Rive set can replace the internals later — call
 * sites never change.
 *
 * State vocabulary (all animals): idle micro-sway (+ host breathing), greet,
 * celebrate, comfort, tap-react (`interactive`).
 */
import LottieView from 'lottie-react-native';
import { SvgXml } from 'react-native-svg';

import { COMPANION_FLUENT } from '@/assets/companions/fluent';
import { COMPANION_LOTTIE } from '@/assets/companions/registry';
import { type CompanionAnimal } from '@/components/art/Companions';
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
  const fluent = COMPANION_FLUENT[resolved];
  void waveTrigger; // kept in the API for a future rig that waves (Rive)

  const art = source ? (
    <LottieView
      source={source}
      autoPlay={!reduced}
      loop={!reduced}
      style={{ width: size, height: size }}
    />
  ) : (
    <SvgXml
      xml={fluent.xml}
      width={size * fluent.scale}
      height={size * fluent.scale}
      // Framing-normalised (face vs full-body emoji) — keep the visual centre.
      style={{ margin: (size - size * fluent.scale) / 2 }}
    />
  );

  return (
    <ReactiveCompanion size={size} trigger={trigger} interactive={interactive} onPress={onPress}>
      {art}
    </ReactiveCompanion>
  );
}

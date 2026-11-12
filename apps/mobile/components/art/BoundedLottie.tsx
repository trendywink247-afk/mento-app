/**
 * BoundedLottie — a Lottie that plays a bounded number of times (lib/motionBudget) and then
 * rests on its last frame, instead of `loop` forever. It plays again when the screen regains
 * focus, the app comes back to the foreground, or `restartKey` changes; it pauses off-screen.
 * Every looping Lottie in the app goes through here (e2e/motion-budget.test.cjs).
 */
import LottieView from 'lottie-react-native';
import { useEffect, useRef, type ComponentProps } from 'react';

import { LOOP_CYCLES, useMotionBudget } from '@/lib/motionBudget';

type Props = Omit<ComponentProps<typeof LottieView>, 'loop' | 'autoPlay' | 'onAnimationFinish' | 'ref'> & {
  /** Plays per bounded run (default LOOP_CYCLES). */
  plays?: number;
  restartKey?: unknown;
};

export function BoundedLottie({ plays = LOOP_CYCLES, restartKey = null, ...rest }: Props) {
  const ref = useRef<LottieView>(null);
  const budget = useMotionBudget(restartKey);
  const played = useRef(0);

  useEffect(() => {
    if (!budget.live) {
      ref.current?.pause();
      return;
    }
    played.current = 0;
    ref.current?.reset();
    ref.current?.play();
  }, [budget.live, budget.run]);

  return (
    <LottieView
      ref={ref}
      {...rest}
      autoPlay={budget.live}
      loop={false}
      onAnimationFinish={(cancelled) => {
        if (cancelled) return;
        played.current += 1;
        if (budget.live && played.current < plays) {
          ref.current?.reset();
          ref.current?.play();
        }
      }}
    />
  );
}

/**
 * Reduce-motion preference (native): AccessibilityInfo + live updates.
 * Web counterpart in useReducedMotion.web.ts (prefers-reduced-motion media query) —
 * same platform-split convention as components/AppProviders*.
 *
 * Every motion primitive consults this: reduced = opacity-only ≤150ms, idle loops off,
 * ambient shader frozen. The flow must remain fully usable with all motion stripped.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (mounted) setReduced(value);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduced;
}

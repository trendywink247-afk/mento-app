/**
 * Reduce-motion preference (web): prefers-reduced-motion media query + live updates.
 * RNW's AccessibilityInfo.isReduceMotionEnabled is a no-op, hence the platform split.
 * Testable via Playwright's page.emulateMedia({ reducedMotion: 'reduce' }).
 */
import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function matches(): boolean {
  return typeof window !== 'undefined' && 'matchMedia' in window
    ? window.matchMedia(QUERY).matches
    : false;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(matches);

  useEffect(() => {
    if (typeof window === 'undefined' || !('matchMedia' in window)) return;
    const mql = window.matchMedia(QUERY);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

import type { ReactNode } from 'react';

/** The browser has no swipe; the long-press menu (right-click) carries the same actions. */
export function SwipeRow({ children }: { children: ReactNode; archived: boolean; onArchive: () => void; onDelete: () => void }) {
  return <>{children}</>;
}

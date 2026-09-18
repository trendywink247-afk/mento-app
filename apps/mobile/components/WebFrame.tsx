import type { ReactNode } from 'react';

/** Native: no frame — the device is the column. Web: see WebFrame.web.tsx. */
export function WebFrame({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

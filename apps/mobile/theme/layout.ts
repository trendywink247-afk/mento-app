/**
 * Layout tokens for wide screens (spec 2026-09-19-desktop-web-layout §3). Phones and
 * native never see these — below `columnMax` the web frame is a passthrough.
 * Components consume these, never raw pixel widths (same rule as colour and motion).
 */
export const layout = {
  /** The app column on wide screens. */
  columnMax: 480,
  /** Two-pane mentor workspace threshold (layout spec step C). */
  workspaceMin: 900,
  /** Mentor workspace left rail (step C). */
  railWidth: 360,
  /** Widest a conversation pane may grow (step C). */
  readingMax: 720,
} as const;

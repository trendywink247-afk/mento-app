/** One Tele-MANAS service, two numbers verified 2026-10-05 (T&S #1):
 * https://dghs.mohfw.gov.in/national-mental-health-programme.php
 * These appear everywhere a member can see
 * them outside a server-sent crisis payload (the allowance note, the feedback sheet's
 * fallback). `tel` is what the dialler gets; `display` is how the number reads. */
export const HELPLINES = [
  { key: 'teleManas', name: 'Tele-MANAS', display: '14416', tel: '14416' },
  { key: 'teleManasAlternate', name: 'Tele-MANAS (alternate number)', display: '1800-89-14416', tel: '18008914416' },
] as const;

export type Helpline = (typeof HELPLINES)[number];

/** A server helpline number ("1800-89-14416") as the dialler wants it. */
export function telHref(number: string): string {
  return `tel:${number.replace(/[^0-9+]/g, '')}`;
}

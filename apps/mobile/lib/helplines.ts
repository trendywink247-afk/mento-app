/** The two verified India helplines (T&S #1) — exactly these, everywhere a member can see
 * them outside a server-sent crisis payload (the allowance note, the feedback sheet's
 * fallback). `tel` is what the dialler gets; `display` is how the number reads. */
export const HELPLINES = [
  { key: 'teleManas', name: 'Tele-MANAS', display: '14416', tel: '14416' },
  { key: 'kiran', name: 'KIRAN', display: '1800-599-0019', tel: '18005990019' },
] as const;

export type Helpline = (typeof HELPLINES)[number];

/** A server helpline number ("1800-599-0019") as the dialler wants it. */
export function telHref(number: string): string {
  return `tel:${number.replace(/[^0-9+]/g, '')}`;
}

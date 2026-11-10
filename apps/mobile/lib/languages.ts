/** The languages a mentor can talk in (mirrors services/api/app/services/languages.py). Each is shown in its
 * own script so a member can find theirs. A language is a preference for matching, never a filter. */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'bn', name: 'বাংলা' },
  { code: 'ta', name: 'தமிழ்' },
  { code: 'te', name: 'తెలుగు' },
  { code: 'mr', name: 'मराठी' },
  { code: 'gu', name: 'ગુજરાતી' },
  { code: 'kn', name: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'മലയാളം' },
  { code: 'pa', name: 'ਪੰਜਾਬੀ' },
  { code: 'or', name: 'ଓଡ଼ିଆ' },
  { code: 'ur', name: 'اردو' },
] as const;

export const MAX_LANGUAGES = 5;

const BY_CODE: Record<string, string> = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.name]));

export function languageName(code: string): string {
  return BY_CODE[code] ?? code;
}

/** "English, हिन्दी" for a mentor's card; empty when they have not said. */
export function languageLine(codes: readonly string[] | null | undefined): string {
  return (codes ?? []).map(languageName).join(', ');
}

/** Toggle one code in a selection, keeping at most MAX_LANGUAGES. */
export function toggleLanguage(selected: string[], code: string): string[] {
  if (selected.includes(code)) return selected.filter((c) => c !== code);
  return selected.length >= MAX_LANGUAGES ? selected : [...selected, code];
}

/** The language to prefer in Browse: the member's own app language. */
export function browseLanguage(locale: string): string {
  return locale === 'hi' ? 'hi' : 'en';
}

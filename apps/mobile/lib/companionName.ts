/**
 * The companion's name (founder ruling 2026-09-19) — the app's mirror of the server's one
 * rule set (`services/api/app/services/companions.py` `clean_name`). The server is the
 * judge; this copy lets the field say so before anything is sent. Keep the two in step.
 *
 * The name is the member's own: it is shown back to them only (Ready, Profile) and is
 * never put in analytics, a Stream payload or anything a mentor sees.
 */
import type { CompanionAnimal } from '@/components/art/Companions';
import type { TKey } from '@/lib/i18n';

export const COMPANION_NAME_MAX = 24;

/** Control characters and the invisible direction / zero-width marks. ZWJ / ZWNJ stay:
 * Devanagari needs them. */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
const URL_LIKE =
  /(:\/\/|\bwww\.|\b[\w-]+\.(com|net|org|in|io|co|app|me|ly|gg|xyz|info|link|site|online|biz|us|uk|to|tk|dev|ai)\b)/i;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** Seven or more digits in one run, with the usual separators — ASCII, Arabic-Indic, the
 * Indian scripts' and full-width digits (a class, not `\p{Nd}`: kinder to older engines). */
const DIGIT = '[0-9\\u0660-\\u0669\\u06F0-\\u06F9\\u0966-\\u096F\\u09E6-\\u09EF\\u0A66-\\u0A6F\\u0AE6-\\u0AEF\\u0B66-\\u0B6F\\u0BE6-\\u0BEF\\u0C66-\\u0C6F\\u0CE6-\\u0CEF\\u0D66-\\u0D6F\\uFF10-\\uFF19]';
const PHONE_LIKE = new RegExp(`${DIGIT}(?:[\\s().+-]*${DIGIT}){6,}`);

/** What the server would keep: invisible marks stripped, whitespace collapsed, trimmed. */
export function tidyCompanionName(raw: string): string {
  return raw.replace(INVISIBLE, '').split(/\s+/).filter(Boolean).join(' ');
}

/** `empty` = nothing to save (skipping is always fine); `invalid` = a calm line and no save. */
export function checkCompanionName(raw: string): { state: 'empty' } | { state: 'ok'; name: string } | { state: 'invalid' } {
  const name = tidyCompanionName(raw);
  if (!name) return { state: 'empty' };
  // Code points, like the server — an emoji is one character, not two.
  if ([...name].length > COMPANION_NAME_MAX) return { state: 'invalid' };
  if (URL_LIKE.test(name) || EMAIL_LIKE.test(name) || PHONE_LIKE.test(name)) return { state: 'invalid' };
  return { state: 'ok', name };
}

/** A gentle, short suggestion per animal for the field's placeholder (EN + HI in the locales). */
const SUGGESTION: Record<CompanionAnimal, TKey> = {
  Panda: 'onboarding.companionName.suggestPanda',
  Dog: 'onboarding.companionName.suggestDog',
  Cat: 'onboarding.companionName.suggestCat',
  Fox: 'onboarding.companionName.suggestFox',
  Capybara: 'onboarding.companionName.suggestCapybara',
  Elephant: 'onboarding.companionName.suggestElephant',
  Turtle: 'onboarding.companionName.suggestTurtle',
  Deer: 'onboarding.companionName.suggestDeer',
  Owl: 'onboarding.companionName.suggestOwl',
};

export function companionNameSuggestionKey(animal: string | null | undefined): TKey {
  return (animal && SUGGESTION[animal as CompanionAnimal]) || 'onboarding.companionName.suggestAny';
}

/** Locale system (H1-remainder C1): i18n-js over locales/{en,hi}.json.
 *
 * Key discipline: `t()` accepts only dotted paths that exist in en.json — a
 * missing key is a COMPILE error, not a runtime fallback. English stays the
 * default and must remain byte-identical when the locale is 'en'.
 *
 * Locale resolution order: persisted `mento.lang` → device language (hi → hi)
 * → en. On web a `?lang=hi` query param (or pre-seeded localStorage — the e2e
 * hook) wins at startup and is persisted.
 */
import { getLocales } from 'expo-localization';
import { I18n } from 'i18n-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';

import en from '@/locales/en.json';
import hi from '@/locales/hi.json';

export type Locale = 'en' | 'hi';

/** Every dotted key path of en.json (e.g. "landing.cta"). */
type Paths<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${Paths<T[K]>}`;
}[keyof T & string];
export type TKey = Paths<typeof en>;

/** Translate function: typed key + optional %{placeholder} interpolation values. */
export type TFunc = (key: TKey, options?: Record<string, string | number>) => string;

const i18n = new I18n({ en, hi });
i18n.defaultLocale = 'en';
i18n.enableFallback = true; // an untranslated key renders English, never a key name

const LANG_KEY = 'mento.lang';

function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'hi';
}

function deviceDefault(): Locale {
  try {
    return getLocales()[0]?.languageCode === 'hi' ? 'hi' : 'en';
  } catch {
    return 'en';
  }
}

/** Web-only synchronous startup resolution (query param → localStorage → device). */
function webInitialLocale(): Locale {
  try {
    const search = globalThis.location?.search;
    if (search) {
      const q = new URLSearchParams(search).get('lang');
      if (isLocale(q)) {
        globalThis.localStorage?.setItem(LANG_KEY, q);
        return q;
      }
    }
    const stored = globalThis.localStorage?.getItem(LANG_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    /* fall through to device default */
  }
  return deviceDefault();
}

type LanguageContextValue = {
  t: TFunc;
  locale: Locale;
  setLocale: (locale: Locale) => void;
};

const LanguageContext = createContext<LanguageContextValue>({
  t: (key, options) => i18n.t(key, options),
  locale: 'en',
  setLocale: () => {},
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    Platform.OS === 'web' ? webInitialLocale() : 'en',
  );

  // Native storage is async — resolve the persisted/device locale after mount.
  // (English-first render for a frame is invisible for en users and brief for hi.)
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let active = true;
    void (async () => {
      try {
        const SecureStore = await import('expo-secure-store');
        const stored = await SecureStore.getItemAsync(LANG_KEY);
        if (active) setLocaleState(isLocale(stored) ? stored : deviceDefault());
      } catch {
        if (active) setLocaleState(deviceDefault());
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    if (Platform.OS === 'web') {
      try {
        globalThis.localStorage?.setItem(LANG_KEY, next);
      } catch {
        /* persistence is best-effort */
      }
      return;
    }
    void import('expo-secure-store')
      .then((SecureStore) => SecureStore.setItemAsync(LANG_KEY, next))
      .catch(() => {});
  }, []);

  i18n.locale = locale; // module-level instance follows the provider

  const value = useMemo<LanguageContextValue>(
    () => ({
      t: (key: TKey, options?: Record<string, string | number>) => i18n.t(key, options),
      locale,
      setLocale,
    }),
    [locale, setLocale],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n(): LanguageContextValue {
  return useContext(LanguageContext);
}

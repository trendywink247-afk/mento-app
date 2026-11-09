/**
 * Prepared answers, kept on this device only (founder, 2026-11-08: device first; server storage is
 * its own reviewed branch). Native: the OS secure store, one key per answer plus an index; web:
 * localStorage (same split as lib/session.ts). Never sent anywhere, and removed when the session is
 * cleared (sign-out, Clean Wipe) so a wiped account leaves nothing behind.
 */
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { MAX_ANSWERS, type PreparedAnswer } from './preparedAnswersCore';

export * from './preparedAnswersCore';

const INDEX_KEY = 'mento.answers.index';
const keyOf = (id: string) => `mento.answers.${id}`;

type Store = {
  setItemAsync(key: string, value: string): Promise<void>;
  getItemAsync(key: string): Promise<string | null>;
  deleteItemAsync(key: string): Promise<void>;
};
const webStore: Store = {
  setItemAsync: async (k, v) => {
    globalThis.localStorage?.setItem(k, v);
  },
  getItemAsync: async (k) => globalThis.localStorage?.getItem(k) ?? null,
  deleteItemAsync: async (k) => {
    globalThis.localStorage?.removeItem(k);
  },
};
const store: Store = Platform.OS === 'web' ? webStore : SecureStore;

async function readIndex(): Promise<string[]> {
  try {
    const raw = await store.getItemAsync(INDEX_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string').slice(0, MAX_ANSWERS) : [];
  } catch {
    return [];
  }
}

export async function loadAnswers(): Promise<PreparedAnswer[]> {
  const ids = await readIndex();
  const out: PreparedAnswer[] = [];
  for (const id of ids) {
    try {
      const raw = await store.getItemAsync(keyOf(id));
      const a = raw ? (JSON.parse(raw) as PreparedAnswer) : null;
      if (a && a.id === id && typeof a.shortcut === 'string' && typeof a.body === 'string') out.push(a);
    } catch {
      /* a damaged answer is skipped, never a crash */
    }
  }
  return out;
}

export async function saveAnswer(a: PreparedAnswer): Promise<void> {
  const ids = await readIndex();
  await store.setItemAsync(keyOf(a.id), JSON.stringify(a));
  if (!ids.includes(a.id)) await store.setItemAsync(INDEX_KEY, JSON.stringify([...ids, a.id]));
}

export async function removeAnswer(id: string): Promise<void> {
  const ids = await readIndex();
  await store.deleteItemAsync(keyOf(id));
  await store.setItemAsync(INDEX_KEY, JSON.stringify(ids.filter((x) => x !== id)));
}

/** Everything, for sign-out and Clean Wipe. */
export async function clearPreparedAnswers(): Promise<void> {
  const ids = await readIndex();
  await Promise.all([...ids.map((id) => store.deleteItemAsync(keyOf(id))), store.deleteItemAsync(INDEX_KEY)]);
}

export function newAnswerId(): string {
  return `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/** The answers, loaded once and kept in step as they are saved or removed. */
export function usePreparedAnswers() {
  const [answers, setAnswers] = useState<PreparedAnswer[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void loadAnswers().then((a) => {
      if (live) {
        setAnswers(a);
        setReady(true);
      }
    });
    return () => {
      live = false;
    };
  }, []);
  const save = useCallback(async (a: PreparedAnswer) => {
    await saveAnswer(a);
    setAnswers((prev) => (prev.some((x) => x.id === a.id) ? prev.map((x) => (x.id === a.id ? a : x)) : [...prev, a]));
  }, []);
  const remove = useCallback(async (id: string) => {
    await removeAnswer(id);
    setAnswers((prev) => prev.filter((x) => x.id !== id));
  }, []);
  return { answers, ready, save, remove };
}

# Native Mentor Console — Plan 2 of 2: Mobile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mentor Home becomes the in-app console (spec `docs/superpowers/specs/2026-09-05-native-mentor-console-design.md` §3–§6, structure A): approved mentors get their credential in-app, see requests and conversations, toggle presence with a heartbeat, and answer chats natively with the mentor rail (helplines, Report, End). The web console reaches rail parity as the last task.

**Architecture:** Requires Plan 1 (server) merged. Storage goes platform-branched (`lib/listenerSession.ts`), the listener client grows four calls and a session-lost signal, Mentor Home gains a `console` state built from three small components plus a data hook, and a new `app/mentor/` route group carries the chat (platform-split: stream-chat-expo kit on native, the existing hand-rolled web thread + rail on web) and the Report transparent-modal. Everything user-visible goes through `useI18n().t()`; every tappable is a `PressKey`.

**Tech Stack:** Expo SDK 52 / expo-router 4 / TS strict, stream-chat-expo (native) + stream-chat JS (web), Reanimated 3.16 (manual shared values), expo-secure-store, Playwright e2e (plain Node scripts, 390×844, 0 page errors, normal + reduced motion).

**Working directory:** `apps/mobile`. Gate: `npx tsc --noEmit`. Browser proofs need API :8000 (seeded, `--host 0.0.0.0` per `.env`) and Expo web :8081 (`npx expo start --web --port 8081 -c` after new routes). Reset before every e2e: `docker exec mento-redis redis-cli FLUSHDB` + `docker exec mento-postgres psql -U mento -d mento -c "UPDATE listener_profiles SET active_conversations = 0;"`.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/listenerSession.ts` | token storage, SecureStore on native / localStorage on web (same `Store` shape as `lib/session.ts`) |
| `lib/listenerApi.ts` | `+ heartbeat, report, end`; 401/403 → `clearListenerSession()` + `onListenerSessionLost` listeners |
| `lib/api.ts` | `+ consoleSession()` (member-auth) + `ConsoleSession` type |
| `lib/listenerStreamClient.ts` | `+ disconnectListenerClient()` |
| `lib/useListenerHeartbeat.ts` | focus-aware 5-minute heartbeat while online |
| `lib/useMentorConsole.ts` | loads me/requests/conversations, refresh on focus, 30 s request poll, Stream unread/preview |
| `components/mentor/PresenceHeader.tsx` | greeting, companion, seats line, online/away toggle |
| `components/mentor/RequestCard.tsx` | one pending request + Accept/Decline |
| `components/mentor/ConversationRow.tsx` | one conversation row (persona, state line, unread pill) |
| `components/mentor/MentorRail.tsx` | not-a-therapist line + Helplines + Report keys |
| `components/mentor/HelplinesSheet.tsx` | tap-to-dial helplines (transparent modal content) |
| `components/mentor/MentorChatScreen.tsx` / `.web.tsx` | chat thread (kit on native; web = today's listener chat + rail + menu) |
| `app/mentor-home.tsx` | `+ console` state |
| `app/mentor/_layout.tsx`, `app/mentor/chat/[id].tsx`, `app/mentor/report.tsx`, `app/mentor/helplines.tsx` | routes |
| `app/listener/chat/[id].tsx` | re-exports `MentorChatScreen` (web parity, last task) |
| `app/start-fresh.tsx`, `app/_layout.tsx` | clear listener session; register routes |
| `locales/en.json`, `locales/hi.json` | `mentor.*` keys |
| `e2e/mentor-console.e2e.js` | browser proof |

---

### Task 1: Platform-branched listener session + client calls

**Files:**
- Modify: `lib/listenerSession.ts`, `lib/listenerApi.ts`, `lib/api.ts`, `lib/listenerStreamClient.ts`

- [ ] **Step 1: Rewrite `lib/listenerSession.ts`:**

```ts
/** Listener-console session storage — distinct keys from the member session so one
 * device can hold BOTH (two-party testing, and honest anyway: the roles never share
 * a token). Native: OS secure store; web: localStorage (same split as lib/session.ts). */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKEN_KEY = 'mento.listener.session_token';

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

export async function saveListenerToken(token: string): Promise<void> {
  await store.setItemAsync(TOKEN_KEY, token);
}

export async function getListenerToken(): Promise<string | null> {
  return store.getItemAsync(TOKEN_KEY);
}

export async function clearListenerSession(): Promise<void> {
  await store.deleteItemAsync(TOKEN_KEY);
}
```

- [ ] **Step 2: Member-auth `consoleSession` in `lib/api.ts`** — next to `ListenerApplication` add:

```ts
/** Native console credential (spec 2026-09-05 §3). Only issued while the application
 * AND the listener profile are approved; 403 `not_approved` otherwise. */
export type ConsoleSession = {
  listener_token: string;
  listener_id: string;
  persona_name: string;
  persona_avatar: string;
  stream_token: string;
  expires_at: string;
};
```
and in the `api` object after `getListenerApplication`:
```ts
  consoleSession: () =>
    request<ConsoleSession>('/listener-applications/me/console-session', { method: 'POST' }, true),
```

- [ ] **Step 3: Listener client** — in `lib/listenerApi.ts` replace the `req` helper and add the calls + session-lost signal:

```ts
import { ApiError, apiRequest } from '@/lib/api';
import { clearListenerSession, getListenerToken } from '@/lib/listenerSession';

export type ListenerReportReason = 'abuse' | 'harassment' | 'spam' | 'other';

/** Fired once whenever a console call comes back 401/403 (token expired or the
 * listener was suspended). Mentor Home subscribes and falls back to the status card;
 * the token is already cleared by then. */
const sessionLostListeners = new Set<() => void>();
export function onListenerSessionLost(fn: () => void): () => void {
  sessionLostListeners.add(fn);
  return () => sessionLostListeners.delete(fn);
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await apiRequest<T>(path, init, getListenerToken);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
      await clearListenerSession();
      sessionLostListeners.forEach((fn) => fn());
    }
    throw e;
  }
}
```
and add to the `listenerApi` object:
```ts
  heartbeat: () => req<{ status: string }>('/listener/me/heartbeat', { method: 'POST' }),

  report: (conversationId: string, reason: ListenerReportReason, note: string | null) =>
    req<{ status: string }>(`/listener/me/conversations/${conversationId}/report`, {
      method: 'POST',
      body: JSON.stringify({ reason, note }),
    }),

  end: (conversationId: string) =>
    req<{ status: string }>(`/listener/me/conversations/${conversationId}/end`, { method: 'POST' }),
```

- [ ] **Step 4: Disconnect helper** — append to `lib/listenerStreamClient.ts`:

```ts
/** Drop the listener identity (session lost, Start Fresh). Safe when never connected. */
export async function disconnectListenerClient(): Promise<void> {
  if (!client?.userID) return;
  const c = client;
  connecting = connecting.catch(() => {}).then(() => c.disconnectUser());
  await connecting;
}
```

- [ ] **Step 5: Start Fresh clears the listener side** — in `app/start-fresh.tsx` import `clearListenerSession` from `@/lib/listenerSession` and `disconnectListenerClient` from `@/lib/listenerStreamClient`; in `confirm` after `await clearSession();` add `await clearListenerSession(); await disconnectListenerClient().catch(() => {});`.

- [ ] **Step 6: Typecheck + commit**

Run: `npx tsc --noEmit` → clean.
```bash
git add lib/listenerSession.ts lib/listenerApi.ts lib/api.ts lib/listenerStreamClient.ts app/start-fresh.tsx
git commit -m "feat(mobile): listener session on SecureStore, console-session/heartbeat/report/end client calls, session-lost signal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Copy keys (EN canonical + HI)

**Files:**
- Modify: `locales/en.json`, `locales/hi.json`

- [ ] **Step 1: Add a top-level `mentor` block to `locales/en.json`** (after `mentorHome`):

```json
"mentor": {
  "greeting": "Good to see you, %{name}",
  "online": "Online",
  "away": "Away",
  "seats": "%{used} of %{max} seats",
  "goOnline": "Go online",
  "goAway": "Take a break",
  "sweptAway": "You were away a while, so we set you to Away.",
  "consoleUnavailable": "Your console isn't available right now.",
  "consoleRetry": "Try again",
  "requestsTitle": "Requests",
  "requestsEmpty": "No requests right now. Being online is enough.",
  "accept": "Accept",
  "decline": "Decline",
  "atCapacity": "You're at capacity — end a conversation before accepting another.",
  "conversationsTitle": "Conversations",
  "conversationsEmpty": "Nothing yet. When someone reaches you, they'll appear here.",
  "typing": "Typing…",
  "masked": "Masked · away right now",
  "ended": "Ended",
  "unread": "%{count} new",
  "more": "More",
  "less": "Less",
  "loadError": "We couldn't load your console.",
  "chat": {
    "back": "Back to console",
    "menu": "Conversation options",
    "notTherapist": "You're a listener, not a therapist.",
    "helplines": "Helplines",
    "report": "Report",
    "end": "End conversation",
    "endTitle": "End this conversation?",
    "endBody": "The member will see it ended. Nothing is deleted.",
    "endConfirm": "End",
    "keep": "Keep talking",
    "opening": "Opening the conversation…",
    "errOpen": "This conversation couldn't be opened. Retry, or go back to the console.",
    "retry": "Retry",
    "reply": "Reply…"
  },
  "helplines": {
    "title": "If someone is in danger",
    "body": "Stay with them. Share a number. You don't have to carry this alone.",
    "teleManas": "Tele-MANAS",
    "kiran": "KIRAN",
    "hours": "24×7, free",
    "close": "Close"
  },
  "reportSheet": {
    "title": "Report this conversation",
    "body": "A human reviewer will look. The member won't be told who reported.",
    "abuse": "Abuse",
    "harassment": "Harassment",
    "spam": "Spam",
    "other": "Something else",
    "notePlaceholder": "Anything that helps the reviewer (optional)",
    "submit": "Send report",
    "cancel": "Cancel",
    "sent": "Thank you. A reviewer will take it from here.",
    "error": "We couldn't send that. Try again in a moment."
  }
}
```

- [ ] **Step 2: Mirror in `locales/hi.json`** with Hindi values (Devanagari; keep `%{…}` placeholders verbatim). Suggested values:

```json
"mentor": {
  "greeting": "आपको देखकर अच्छा लगा, %{name}",
  "online": "ऑनलाइन",
  "away": "दूर",
  "seats": "%{max} में से %{used} सीटें",
  "goOnline": "ऑनलाइन जाएँ",
  "goAway": "थोड़ा विराम लें",
  "sweptAway": "आप कुछ देर दूर थे, इसलिए हमने आपको ‘दूर’ कर दिया।",
  "consoleUnavailable": "आपका कंसोल अभी उपलब्ध नहीं है।",
  "consoleRetry": "फिर कोशिश करें",
  "requestsTitle": "अनुरोध",
  "requestsEmpty": "अभी कोई अनुरोध नहीं। ऑनलाइन रहना ही काफ़ी है।",
  "accept": "स्वीकार करें",
  "decline": "अस्वीकार करें",
  "atCapacity": "आपकी सीटें भरी हैं — नया स्वीकारने से पहले एक बातचीत समाप्त करें।",
  "conversationsTitle": "बातचीत",
  "conversationsEmpty": "अभी कुछ नहीं। जब कोई आप तक पहुँचेगा, यहाँ दिखेगा।",
  "typing": "लिख रहे हैं…",
  "masked": "मास्क · अभी दूर",
  "ended": "समाप्त",
  "unread": "%{count} नए",
  "more": "और",
  "less": "कम",
  "loadError": "हम आपका कंसोल लोड नहीं कर सके।",
  "chat": {
    "back": "कंसोल पर वापस",
    "menu": "बातचीत के विकल्प",
    "notTherapist": "आप एक श्रोता हैं, थेरेपिस्ट नहीं।",
    "helplines": "हेल्पलाइन",
    "report": "रिपोर्ट",
    "end": "बातचीत समाप्त करें",
    "endTitle": "यह बातचीत समाप्त करें?",
    "endBody": "सदस्य को यह समाप्त दिखेगी। कुछ भी मिटाया नहीं जाता।",
    "endConfirm": "समाप्त करें",
    "keep": "बात जारी रखें",
    "opening": "बातचीत खुल रही है…",
    "errOpen": "यह बातचीत नहीं खुल सकी। फिर कोशिश करें, या कंसोल पर लौटें।",
    "retry": "फिर कोशिश करें",
    "reply": "जवाब…"
  },
  "helplines": {
    "title": "अगर कोई ख़तरे में है",
    "body": "उनके साथ रहें। एक नंबर साझा करें। यह बोझ आपको अकेले नहीं उठाना है।",
    "teleManas": "टेली-मानस",
    "kiran": "किरण",
    "hours": "24×7, निःशुल्क",
    "close": "बंद करें"
  },
  "reportSheet": {
    "title": "इस बातचीत की रिपोर्ट करें",
    "body": "एक व्यक्ति इसे देखेगा। सदस्य को नहीं बताया जाएगा कि किसने रिपोर्ट की।",
    "abuse": "दुर्व्यवहार",
    "harassment": "उत्पीड़न",
    "spam": "स्पैम",
    "other": "कुछ और",
    "notePlaceholder": "जो समीक्षक की मदद करे (वैकल्पिक)",
    "submit": "रिपोर्ट भेजें",
    "cancel": "रद्द करें",
    "sent": "धन्यवाद। अब समीक्षक इसे देखेंगे।",
    "error": "हम इसे भेज नहीं सके। थोड़ी देर में फिर कोशिश करें।"
  }
}
```

- [ ] **Step 3: Typecheck + commit** — `npx tsc --noEmit` (TKey derives from `en.json`; a missing HI key is caught by the i18n test if one exists — run `node -e "const e=require('./locales/en.json'),h=require('./locales/hi.json');const walk=(o,p='')=>Object.entries(o).flatMap(([k,v])=>typeof v==='object'?walk(v,p+k+'.'):[p+k]);const eh=walk(e),hh=new Set(walk(h));console.log(eh.filter(k=>!hh.has(k)))"` → `[]`).
```bash
git add locales/en.json locales/hi.json
git commit -m "feat(i18n): mentor console copy (EN + HI)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Heartbeat hook + console data hook

**Files:**
- Create: `lib/useListenerHeartbeat.ts`, `lib/useMentorConsole.ts`

- [ ] **Step 1: `lib/useListenerHeartbeat.ts`:**

```ts
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

import { listenerApi } from '@/lib/listenerApi';

const HEARTBEAT_MS = 5 * 60 * 1000;

/** Presence pulse (spec 2026-09-05 §6): while this screen is focused AND the mentor
 * is online, POST /listener/me/heartbeat once now and every 5 minutes. The server
 * marks a mentor away 15 minutes after the last pulse. Failures are silent — the
 * sweep is the safety net, not the client. */
export function useListenerHeartbeat(enabled: boolean): void {
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return;
      const beat = () => void listenerApi.heartbeat().catch(() => {});
      beat();
      const id = setInterval(beat, HEARTBEAT_MS);
      return () => clearInterval(id);
    }, [enabled]),
  );
}
```

- [ ] **Step 2: `lib/useMentorConsole.ts`:**

```ts
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Event } from 'stream-chat';

import { ApiError } from '@/lib/api';
import {
  listenerApi,
  onListenerSessionLost,
  type ListenerConversation,
  type ListenerMe,
  type ListenerRequest,
} from '@/lib/listenerApi';
import { ensureListenerConnected } from '@/lib/listenerStreamClient';

const REQUEST_POLL_MS = 30_000;

export type ChannelLive = { unread: number; preview: string | null; typing: boolean };

export type MentorConsole = {
  me: ListenerMe | null;
  requests: ListenerRequest[];
  conversations: ListenerConversation[];
  /** Keyed by stream_channel_id — unread count, last text and typing from Stream. */
  live: Record<string, ChannelLive>;
  loading: boolean;
  error: 'session' | 'network' | null;
  note: string | null;
  refresh: () => Promise<void>;
  toggleStatus: () => Promise<void>;
  act: (requestId: string, action: 'accept' | 'decline') => Promise<void>;
  busy: string | null;
};

/** Everything Mentor Home's console state needs (spec §4). Refresh on focus, requests
 * re-poll every 30 s while focused, unread/preview/typing from the listener Stream
 * client's channel events (never polled). Session loss → `error: 'session'`. */
export function useMentorConsole(atCapacityText: string): MentorConsole {
  const [me, setMe] = useState<ListenerMe | null>(null);
  const [requests, setRequests] = useState<ListenerRequest[]>([]);
  const [conversations, setConversations] = useState<ListenerConversation[]>([]);
  const [live, setLive] = useState<Record<string, ChannelLive>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<'session' | 'network' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    try {
      const meData = await listenerApi.me();
      const [reqs, cons] = await Promise.all([listenerApi.requests(), listenerApi.conversations()]);
      setMe(meData);
      setRequests(reqs);
      setConversations(cons);
      setError(null);
      // Watch active channels for unread/preview/typing.
      const client = await ensureListenerConnected(
        { id: meData.id, name: meData.persona_name },
        meData.stream_token,
      );
      unsubscribeRef.current?.();
      const subs: (() => void)[] = [];
      for (const c of cons) {
        if (!c.stream_channel_id || c.status !== 'active') continue;
        const ch = client.channel('messaging', c.stream_channel_id);
        await ch.watch();
        const cid = c.stream_channel_id;
        const last = ch.state.messages[ch.state.messages.length - 1];
        setLive((prev) => ({
          ...prev,
          [cid]: { unread: ch.countUnread(), preview: last?.text ?? null, typing: false },
        }));
        const onNew = (e: Event) =>
          setLive((prev) => ({
            ...prev,
            [cid]: { unread: ch.countUnread(), preview: e.message?.text ?? prev[cid]?.preview ?? null, typing: false },
          }));
        const onRead = () => setLive((prev) => ({ ...prev, [cid]: { ...(prev[cid] ?? { preview: null, typing: false }), unread: ch.countUnread() } }));
        const onTypingStart = (e: Event) => {
          if (e.user?.id !== client.userID) setLive((prev) => ({ ...prev, [cid]: { ...(prev[cid] ?? { unread: 0, preview: null }), typing: true } }));
        };
        const onTypingStop = () => setLive((prev) => ({ ...prev, [cid]: { ...(prev[cid] ?? { unread: 0, preview: null }), typing: false } }));
        ch.on('message.new', onNew);
        ch.on('message.read', onRead);
        ch.on('typing.start', onTypingStart);
        ch.on('typing.stop', onTypingStop);
        subs.push(() => {
          ch.off('message.new', onNew);
          ch.off('message.read', onRead);
          ch.off('typing.start', onTypingStart);
          ch.off('typing.stop', onTypingStop);
        });
      }
      unsubscribeRef.current = () => subs.forEach((u) => u());
    } catch (e) {
      setError(e instanceof ApiError && (e.status === 401 || e.status === 403) ? 'session' : 'network');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      const id = setInterval(() => void listenerApi.requests().then(setRequests).catch(() => {}), REQUEST_POLL_MS);
      return () => {
        clearInterval(id);
        unsubscribeRef.current?.();
        unsubscribeRef.current = null;
      };
    }, [refresh]),
  );

  useEffect(() => onListenerSessionLost(() => setError('session')), []);

  const toggleStatus = useCallback(async () => {
    if (!me || busy) return;
    setBusy('status');
    try {
      setMe(await listenerApi.setStatus(me.status === 'online' ? 'away' : 'online'));
      setNote(null);
    } catch {
      setNote(null); // stillness: the toggle simply stays where it was
    } finally {
      setBusy(null);
    }
  }, [me, busy]);

  const act = useCallback(
    async (requestId: string, action: 'accept' | 'decline') => {
      if (busy) return;
      setBusy(requestId);
      setNote(null);
      try {
        if (action === 'accept') await listenerApi.accept(requestId);
        else await listenerApi.decline(requestId);
        await refresh();
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) setNote(atCapacityText);
      } finally {
        setBusy(null);
      }
    },
    [busy, refresh, atCapacityText],
  );

  return { me, requests, conversations, live, loading, error, note, refresh, toggleStatus, act, busy };
}
```

- [ ] **Step 3: Typecheck + commit** — `npx tsc --noEmit` clean.
```bash
git add lib/useListenerHeartbeat.ts lib/useMentorConsole.ts
git commit -m "feat(mobile): mentor console data hook (focus refresh, 30s request poll, Stream unread/typing) + heartbeat hook

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Console components + Mentor Home `console` state

**Files:**
- Create: `components/mentor/PresenceHeader.tsx`, `components/mentor/RequestCard.tsx`, `components/mentor/ConversationRow.tsx`
- Modify: `app/mentor-home.tsx`

- [ ] **Step 1: `components/mentor/PresenceHeader.tsx`:**

```tsx
import { StyleSheet, Text, View } from 'react-native';

import { Companion } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { PressKey } from '@/components/motion/PressKey';
import { Tilt3D } from '@/components/motion/Tilt3D';
import { useI18n } from '@/lib/i18n';
import type { ListenerMe } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/** Console greeting: the mentor's companion, persona, seats, and the presence key. */
export function PresenceHeader({
  me,
  animal,
  busy,
  onToggle,
}: {
  me: ListenerMe;
  animal: CompanionAnimal | null;
  busy: boolean;
  onToggle: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const online = me.status === 'online';
  return (
    <View style={styles.wrap} testID="mentor-console">
      <Tilt3D maxTilt={6}>
        <Companion animal={animal} size={96} trigger={{ kind: 'greet', n: 1 }} />
      </Tilt3D>
      <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
        {t('mentor.greeting', { name: me.persona_name })}
      </Text>
      <Text style={[type.caption, { color: online ? colors.success : colors.inkMuted }]} testID="mentor-presence">
        {online ? '● ' : ''}
        {t(online ? 'mentor.online' : 'mentor.away')} · {t('mentor.seats', { used: me.active_conversations, max: me.max_concurrent })}
      </Text>
      <PressKey
        onPress={onToggle}
        disabled={busy}
        edge={online ? colors.edgeSurface : colors.accentEdge}
        radius={radius.pill}
        travel={3}
        accessibilityRole="switch"
        accessibilityState={{ checked: online }}
        testID="mentor-status-toggle"
        style={[styles.toggle, online ? { backgroundColor: colors.surface } : { backgroundColor: colors.accent }]}
        containerStyle={{ marginTop: space.sm }}
      >
        <Text style={[styles.toggleText, { color: online ? colors.ink : colors.onAccent }]}>
          {t(online ? 'mentor.goAway' : 'mentor.goOnline')}
        </Text>
      </PressKey>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space.xs, marginTop: space.lg, marginBottom: space.lg },
  title: { ...type.displayHeadline, textAlign: 'center' },
  toggle: { borderRadius: radius.pill, paddingVertical: space.sm, paddingHorizontal: space.lg },
  toggleText: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 20 },
});
```

- [ ] **Step 2: `components/mentor/RequestCard.tsx`:**

```tsx
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { PressKey } from '@/components/motion/PressKey';
import { formatTopic } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { ListenerRequest } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

const PREVIEW_LINES = 3;

/** One pending Personal request: requester persona, category, intro, Accept/Decline. */
export function RequestCard({
  request,
  busy,
  onAccept,
  onDecline,
}: {
  request: ListenerRequest;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const long = (request.intro_message?.length ?? 0) > 160;
  return (
    <EdgeSurface edge={colors.edgeSurface} style={[styles.card, { backgroundColor: colors.surface }]} testID={`mentor-request-${request.id}`}>
      <View style={styles.row}>
        <PersonaAvatar name={request.requester_persona_name} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.name, { color: colors.ink }]}>{request.requester_persona_name}</Text>
          {request.issue_category ? (
            <Text style={[type.caption, { color: colors.accent }]}>{formatTopic(request.issue_category)}</Text>
          ) : null}
        </View>
      </View>
      {request.intro_message ? (
        <>
          <Text style={[type.body, { color: colors.ink }]} numberOfLines={expanded ? undefined : PREVIEW_LINES}>
            {request.intro_message}
          </Text>
          {long ? (
            <PressKey onPress={() => setExpanded((v) => !v)} edge="transparent" travel={2} haptic="none" style={styles.more}>
              <Text style={[type.caption, { color: colors.accent }]}>{t(expanded ? 'mentor.less' : 'mentor.more')}</Text>
            </PressKey>
          ) : null}
        </>
      ) : null}
      <View style={styles.actions}>
        <PressKey onPress={onAccept} disabled={busy} edge={colors.accentEdge} style={[styles.key, { backgroundColor: colors.accent }]} containerStyle={{ flex: 1 }} testID={`mentor-accept-${request.id}`}>
          <Text style={[styles.keyText, { color: colors.onAccent }]}>{t('mentor.accept')}</Text>
        </PressKey>
        <PressKey onPress={onDecline} disabled={busy} edge={colors.edgeAlt} style={[styles.key, { backgroundColor: colors.surfaceAlt }]} containerStyle={{ flex: 1 }} testID={`mentor-decline-${request.id}`}>
          <Text style={[styles.keyText, { color: colors.ink }]}>{t('mentor.decline')}</Text>
        </PressKey>
      </View>
    </EdgeSurface>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.md, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 22 },
  more: { alignSelf: 'flex-start', paddingVertical: 2 },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  key: { borderRadius: radius.md, paddingVertical: space.sm, alignItems: 'center' },
  keyText: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 20 },
});
```

- [ ] **Step 3: `components/mentor/ConversationRow.tsx`:**

```tsx
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import type { ListenerConversation } from '@/lib/listenerApi';
import type { ChannelLive } from '@/lib/useMentorConsole';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/** One conversation: member persona, state line, unread pill. Tap → mentor chat. */
export function ConversationRow({
  conversation,
  live,
  onPress,
}: {
  conversation: ListenerConversation;
  live: ChannelLive | undefined;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const active = conversation.status === 'active';
  const stateLine = !active
    ? t('mentor.ended')
    : live?.typing
      ? t('mentor.typing')
      : conversation.member_masked
        ? t('mentor.masked')
        : (live?.preview ?? '');
  return (
    <PressKey
      onPress={onPress}
      edge={colors.edgeSurface}
      style={[styles.row, { backgroundColor: colors.surface, opacity: active ? 1 : 0.7 }]}
      accessibilityLabel={conversation.user_persona_name}
      testID={`mentor-convo-${conversation.id}`}
    >
      <PersonaAvatar name={conversation.user_persona_name} size={44} online={active && !conversation.member_masked} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.name, { color: colors.ink }]} numberOfLines={1}>
          {conversation.user_persona_name}
        </Text>
        <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={1}>
          {stateLine}
        </Text>
      </View>
      {live && live.unread > 0 ? (
        <View style={[styles.pill, { backgroundColor: colors.accentTint }]} testID={`mentor-unread-${conversation.id}`}>
          <Text style={[type.caption, { color: colors.accentEdge }]}>{t('mentor.unread', { count: live.unread })}</Text>
        </View>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
      )}
    </PressKey>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.lg, padding: space.sm + 2 },
  name: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 22 },
  pill: { borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: space.sm },
});
```

- [ ] **Step 4: Mentor Home `console` state** — in `app/mentor-home.tsx`:
  - imports: `ConversationRow`, `PresenceHeader`, `RequestCard`, `api` already, `getListenerToken, saveListenerToken` from `@/lib/listenerSession`, `useListenerHeartbeat`, `useMentorConsole`, `ApiError`;
  - state: `const [consoleReady, setConsoleReady] = useState<boolean | 'unavailable' | null>(null);` (`null` = not attempted);
  - after `loadApplication` resolves with `approved`, run `ensureConsole`:
    ```ts
    const ensureConsole = useCallback(async () => {
      if (await getListenerToken()) {
        setConsoleReady(true);
        return;
      }
      try {
        const cs = await api.consoleSession();
        await saveListenerToken(cs.listener_token);
        setConsoleReady(true);
      } catch (e) {
        setConsoleReady(e instanceof ApiError && e.status === 403 ? 'unavailable' : 'unavailable');
      }
    }, []);
    ```
    and inside `loadApplication` after `setApplication(app)`: `if (app?.status === 'approved') await ensureConsole(); else setConsoleReady(null);`
  - split the console UI into a child component so the hooks only mount when ready:
    ```tsx
    function ConsoleBody({ animal, onSessionLost }: { animal: CompanionAnimal | null; onSessionLost: () => void }) {
      const router = useRouter();
      const { colors } = useTheme();
      const { t } = useI18n();
      const console_ = useMentorConsole(t('mentor.atCapacity'));
      useListenerHeartbeat(console_.me?.status === 'online');
      useEffect(() => {
        if (console_.error === 'session') onSessionLost();
      }, [console_.error, onSessionLost]);
      if (console_.loading && !console_.me) return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>;
      if (!console_.me) {
        return (
          <View style={[styles.card, { backgroundColor: colors.surface }]} testID="mentor-console-error">
            <Text style={[type.body, { color: colors.ink }]}>{t('mentor.loadError')}</Text>
            <PrimaryButton label={t('mentor.consoleRetry')} variant="ghost" onPress={() => void console_.refresh()} />
          </View>
        );
      }
      const active = console_.conversations.filter((c) => c.status === 'active');
      const past = console_.conversations.filter((c) => c.status !== 'active');
      return (
        <>
          <PresenceHeader me={console_.me} animal={animal} busy={console_.busy === 'status'} onToggle={() => void console_.toggleStatus()} />
          <Text style={[styles.section, { color: colors.ink }]}>{t('mentor.requestsTitle')}</Text>
          {console_.note ? <Text style={[type.caption, { color: colors.warning }]} testID="mentor-note">{console_.note}</Text> : null}
          {console_.requests.length === 0 ? (
            <Text style={[type.body, { color: colors.inkMuted }]} testID="mentor-requests-empty">{t('mentor.requestsEmpty')}</Text>
          ) : (
            console_.requests.map((r) => (
              <RequestCard key={r.id} request={r} busy={console_.busy === r.id} onAccept={() => void console_.act(r.id, 'accept')} onDecline={() => void console_.act(r.id, 'decline')} />
            ))
          )}
          <Text style={[styles.section, { color: colors.ink }]}>{t('mentor.conversationsTitle')}</Text>
          {console_.conversations.length === 0 ? (
            <Text style={[type.body, { color: colors.inkMuted }]} testID="mentor-convos-empty">{t('mentor.conversationsEmpty')}</Text>
          ) : (
            [...active, ...past].map((c) => (
              <ConversationRow
                key={c.id}
                conversation={c}
                live={c.stream_channel_id ? console_.live[c.stream_channel_id] : undefined}
                onPress={() => router.push({ pathname: '/mentor/chat/[id]', params: { id: c.id, channel: c.stream_channel_id ?? '', member: c.user_persona_name, masked: c.member_masked ? '1' : '0' } })}
              />
            ))
          )}
        </>
      );
    }
    ```
    (add `section: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 22, marginTop: space.md, marginBottom: space.xs }` to styles and import `font`.)
  - in the approved branch of the JSX: when `consoleReady === true` render `<ConsoleBody animal={animal} onSessionLost={() => setConsoleReady(null)} />` **instead of** the status card; when `'unavailable'` render the existing status card with a `mentor.consoleUnavailable` line and a retry key calling `ensureConsole` (testID `mentor-console-retry`); when `null` (still minting) render the spinner. Remove the `Linking.openURL(console_url)` link entirely (the browser hop is retired on native and web alike — web users of the app get the same console).
  - keep the hero (`mentor-home` testID) only for the non-console states; in the console state `PresenceHeader` is the hero (it carries `mentor-console`).
  - the existing `switchToTalk` key stays at the bottom in every state.

- [ ] **Step 5: Routes** — create `app/mentor/_layout.tsx`:
```tsx
import { Stack } from 'expo-router';

/** Mentor console routes: chat (fade, like the member chat) + transparent-modal sheets. */
export default function MentorLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="chat/[id]" options={{ animation: 'fade' }} />
      <Stack.Screen name="report" options={{ presentation: 'transparentModal', animation: 'fade' }} />
      <Stack.Screen name="helplines" options={{ presentation: 'transparentModal', animation: 'fade' }} />
    </Stack>
  );
}
```
and a placeholder `app/mentor/chat/[id].tsx` that renders a `WebOnlyNotice`-free stub for now:
```tsx
export { default } from '@/components/mentor/MentorChatScreen';
```
(Task 5 creates the component; until then create `components/mentor/MentorChatScreen.tsx` exporting a component that renders `<View />` so tsc passes — Task 5 replaces it.) Note `app/mentor/[id].tsx` (member-side mentor profile) already exists at `app/mentor/[id].tsx` — the new group adds sibling files; no conflict because `chat/[id]` is nested.

- [ ] **Step 6: Restart Expo `-c`, typecheck, drive it** — `npx tsc --noEmit` clean. Manual browser check at 390×844: approve an application (admin API), open `/mentor-home` → console renders with `mentor-console`, toggle flips, empty states show, 0 console errors.

- [ ] **Step 7: Commit**
```bash
git add components/mentor app/mentor-home.tsx app/mentor lib
git commit -m "feat(mobile): Mentor Home is the console — presence header, request cards, conversation rows, in-app credential

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Native mentor chat + mentor rail + sheets

**Files:**
- Create: `components/mentor/MentorRail.tsx`, `components/mentor/HelplinesSheet.tsx`, `components/mentor/MentorChatScreen.tsx` (replace stub), `app/mentor/report.tsx`, `app/mentor/helplines.tsx`

- [ ] **Step 1: `components/mentor/MentorRail.tsx`:**

```tsx
import { StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/** The mentor rail (spec §5): a quiet strip above the composer. */
export function MentorRail({ onHelplines, onReport }: { onHelplines: () => void; onReport: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <EdgeSurface edge={colors.edgeAlt} radius={radius.md} style={[styles.rail, { backgroundColor: colors.surfaceAlt }]} containerStyle={styles.wrap} testID="mentor-rail">
      <Text style={[type.caption, { color: colors.inkMuted, flex: 1 }]} numberOfLines={2}>
        {t('mentor.chat.notTherapist')}
      </Text>
      <View style={styles.keys}>
        <PressKey onPress={onHelplines} edge={colors.edgeSurface} travel={3} radius={radius.pill} style={[styles.key, { backgroundColor: colors.surface }]} testID="mentor-helplines">
          <Text style={[styles.keyText, { color: colors.ink }]}>{t('mentor.chat.helplines')}</Text>
        </PressKey>
        <PressKey onPress={onReport} edge={colors.edgeSurface} travel={3} radius={radius.pill} style={[styles.key, { backgroundColor: colors.surface }]} testID="mentor-report">
          <Text style={[styles.keyText, { color: colors.danger }]}>{t('mentor.chat.report')}</Text>
        </PressKey>
      </View>
    </EdgeSurface>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: space.md, marginBottom: space.xs },
  rail: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm, borderRadius: radius.md },
  keys: { flexDirection: 'row', gap: space.xs },
  key: { borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: space.sm },
  keyText: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16 },
});
```

- [ ] **Step 2: `components/mentor/HelplinesSheet.tsx`** (content only; the route wraps it in the scrim):

```tsx
import { Linking, StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/** Verified India helplines (docs/PRIVACY.md sourcing, re-verified session 29). */
const HELPLINES = [
  { key: 'teleManas' as const, number: '14416' },
  { key: 'kiran' as const, number: '1800-599-0019' },
];

export function HelplinesSheet({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]} testID="helplines-sheet">
      <Text style={[styles.title, { color: colors.ink }]}>{t('mentor.helplines.title')}</Text>
      <Text style={[type.body, { color: colors.inkMuted }]}>{t('mentor.helplines.body')}</Text>
      {HELPLINES.map((h) => (
        <PressKey
          key={h.number}
          onPress={() => void Linking.openURL(`tel:${h.number.replace(/-/g, '')}`)}
          edge={colors.edgeSurface}
          style={[styles.line, { backgroundColor: colors.surfaceAlt }]}
          accessibilityRole="button"
          testID={`helpline-${h.key}`}
        >
          <IconBadge icon="call-outline" size={36} tone="green" />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: colors.ink }]}>{t(`mentor.helplines.${h.key}`)}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{h.number} · {t('mentor.helplines.hours')}</Text>
          </View>
        </PressKey>
      ))}
      <PrimaryButton label={t('mentor.helplines.close')} variant="link" onPress={onClose} testID="helplines-close" />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.sm, width: '100%', maxWidth: 420 },
  title: { fontFamily: font.sansHeavy, fontSize: 20, lineHeight: 26 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, padding: space.sm },
});
```

- [ ] **Step 3: Routes for the two sheets** — `app/mentor/helplines.tsx`:

```tsx
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { HelplinesSheet } from '@/components/mentor/HelplinesSheet';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

/** transparentModal route (never RN <Modal> — blank on Android new-arch). */
export default function HelplinesRoute() {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <View style={[styles.backdrop, { backgroundColor: colors.scrim }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => router.back()} accessibilityLabel="Dismiss" />
      <HelplinesSheet onClose={() => router.back()} />
    </View>
  );
}

const styles = StyleSheet.create({ backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.md } });
```

`app/mentor/report.tsx`:

```tsx
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n, type TKey } from '@/lib/i18n';
import { listenerApi, type ListenerReportReason } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

const REASONS: { key: ListenerReportReason; label: TKey }[] = [
  { key: 'abuse', label: 'mentor.reportSheet.abuse' },
  { key: 'harassment', label: 'mentor.reportSheet.harassment' },
  { key: 'spam', label: 'mentor.reportSheet.spam' },
  { key: 'other', label: 'mentor.reportSheet.other' },
];

/** Mentor-side report (spec §5). transparentModal route; files against the
 * conversation, never ends it — moderation decides. Errors go still. */
export default function MentorReportRoute() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [reason, setReason] = useState<ListenerReportReason | null>(null);
  const [note, setNote] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const submit = async () => {
    if (!reason || !id || state === 'sending') return;
    setState('sending');
    try {
      await listenerApi.report(id, reason, note.trim() ? note.trim().slice(0, 300) : null);
      setState('sent');
    } catch {
      setState('error');
    }
  };

  return (
    <View style={[styles.backdrop, { backgroundColor: colors.scrim }]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => router.back()} accessibilityLabel="Dismiss" />
      <View style={[styles.card, { backgroundColor: colors.surface }]} testID="mentor-report-sheet">
        {state === 'sent' ? (
          <>
            <Text style={[type.body, { color: colors.ink }]} testID="mentor-report-sent">{t('mentor.reportSheet.sent')}</Text>
            <PrimaryButton label={t('mentor.helplines.close')} onPress={() => router.back()} testID="mentor-report-done" />
          </>
        ) : (
          <>
            <Text style={[styles.title, { color: colors.ink }]}>{t('mentor.reportSheet.title')}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentor.reportSheet.body')}</Text>
            <View style={styles.chips}>
              {REASONS.map((r) => {
                const on = reason === r.key;
                return (
                  <PressKey key={r.key} onPress={() => setReason(r.key)} edge={on ? colors.accentEdge : colors.edgeSurface} travel={3} radius={radius.pill} accessibilityState={{ selected: on }} style={[styles.chip, { backgroundColor: on ? colors.accent : colors.surfaceAlt }]} testID={`report-reason-${r.key}`}>
                    <Text style={[styles.chipText, { color: on ? colors.onAccent : colors.ink }]}>{t(r.label)}</Text>
                  </PressKey>
                );
              })}
            </View>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={t('mentor.reportSheet.notePlaceholder')}
              placeholderTextColor={colors.inkMuted}
              maxLength={300}
              multiline
              style={[styles.input, { color: colors.ink, backgroundColor: colors.surfaceAlt }]}
              testID="report-note"
            />
            {state === 'error' ? <Text style={[type.caption, { color: colors.danger }]}>{t('mentor.reportSheet.error')}</Text> : null}
            <PrimaryButton label={t('mentor.reportSheet.submit')} onPress={() => void submit()} disabled={!reason} loading={state === 'sending'} testID="report-submit" />
            <PrimaryButton label={t('mentor.reportSheet.cancel')} variant="link" onPress={() => router.back()} disabled={state === 'sending'} testID="report-cancel" />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.md },
  card: { borderRadius: radius.lg, padding: space.lg, gap: space.sm, width: '100%', maxWidth: 420 },
  title: { fontFamily: font.sansHeavy, fontSize: 20, lineHeight: 26 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: { borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: space.sm },
  chipText: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  input: { minHeight: 72, borderRadius: radius.md, padding: space.sm, textAlignVertical: 'top', ...type.body },
});
```

- [ ] **Step 4: Native chat `components/mentor/MentorChatScreen.tsx`** (replace the stub). Model on `components/chat/ChatScreen.tsx`; differences: listener client + `listenerApi.me()` token, member persona header with Masked chip, no options sheet / notes / starter, `MentorRail` above the composer, `⋯` menu → Report (push `/mentor/report?id=`) and End (inline confirm strip → `listenerApi.end` → `router.replace('/mentor-home')`).

```tsx
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { ComponentProps } from 'react';
import type { Channel as ChannelType, Event } from 'stream-chat';
import { Channel, Chat, MessageComposer, MessageList } from 'stream-chat-expo';

import { CrisisCard, type CrisisPayload } from '@/components/chat/CrisisCard';
import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { MentorRail } from '@/components/mentor/MentorRail';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { listenerApi } from '@/lib/listenerApi';
import { ensureListenerConnected, getListenerStreamClient } from '@/lib/listenerStreamClient';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

type StreamChatStyle = ComponentProps<typeof Chat>['style'];
type CrisisCarrier = { id?: string; crisis?: CrisisPayload };

/** Mentor-side chat, native (spec §5): stream-chat-expo kit on the LISTENER client,
 * member persona header, server-injected crisis card, mentor rail, Report/End. */
export default function MentorChatScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const { id: conversationId, channel: channelId, member, masked } = useLocalSearchParams<{
    id: string;
    channel?: string;
    member?: string;
    masked?: string;
  }>();
  const memberName = member ?? '';
  const [channel, setChannel] = useState<ChannelType | null>(null);
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [menu, setMenu] = useState<'closed' | 'open' | 'confirmEnd'>('closed');
  const [ending, setEnding] = useState(false);
  const shownRef = useRef<Set<string>>(new Set());

  const surfaceCrisis = useCallback((m: CrisisCarrier | undefined) => {
    if (m?.crisis && m.id && !shownRef.current.has(m.id)) {
      shownRef.current.add(m.id);
      setCrisis(m.crisis);
    }
  }, []);

  const streamTheme = useMemo<StreamChatStyle>(
    () => ({
      semantics: {
        accentPrimary: colors.accent,
        backgroundCoreApp: colors.bg,
        chatBgIncoming: colors.surface,
        chatTextIncoming: colors.ink,
        chatBgOutgoing: colors.accentTint,
        chatTextOutgoing: colors.ink,
        chatTextTimestamp: colors.inkMuted,
        buttonPrimaryBg: colors.accent,
      },
    }),
    [colors],
  );

  useEffect(() => {
    let cancelled = false;
    const setup = async () => {
      try {
        if (!channelId) throw new Error('missing channel');
        const me = await listenerApi.me();
        const client = await ensureListenerConnected({ id: me.id, name: me.persona_name }, me.stream_token);
        const ch = client.channel('messaging', channelId);
        await ch.watch();
        if (cancelled) return;
        setChannel(ch);
        setError(false);
        ch.state.messages.forEach((m) => surfaceCrisis(m as CrisisCarrier));
        ch.on('message.new', (e: Event) => surfaceCrisis(e.message as CrisisCarrier));
      } catch {
        if (!cancelled) setError(true);
      }
    };
    void setup();
    return () => {
      cancelled = true;
    };
  }, [channelId, surfaceCrisis, attempt]);

  const endNow = async () => {
    if (!conversationId || ending) return;
    setEnding(true);
    try {
      await listenerApi.end(conversationId);
      router.replace('/mentor-home');
    } catch {
      setEnding(false);
      setMenu('closed');
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <View style={[styles.header, { backgroundColor: colors.surface }]}>
        <Pressable onPress={() => router.replace('/mentor-home')} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('mentor.chat.back')} testID="mentor-chat-back">
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </Pressable>
        <PersonaAvatar name={memberName} size={44} online={masked !== '1'} />
        <View style={{ flex: 1 }} accessible accessibilityRole="header">
          <Text style={[styles.personaName, { color: colors.ink }]} numberOfLines={1}>{memberName}</Text>
          {masked === '1' ? <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentor.masked')}</Text> : null}
        </View>
        <Pressable onPress={() => setMenu((m) => (m === 'closed' ? 'open' : 'closed'))} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('mentor.chat.menu')} testID="mentor-chat-menu">
          <Ionicons name="ellipsis-vertical" size={20} color={colors.inkMuted} />
        </Pressable>
      </View>

      {menu !== 'closed' ? (
        <View style={[styles.menu, { backgroundColor: colors.surfaceAlt }]} testID="mentor-chat-menu-sheet">
          {menu === 'open' ? (
            <>
              <PressKey onPress={() => { setMenu('closed'); router.push({ pathname: '/mentor/report', params: { id: conversationId ?? '' } }); }} edge={colors.edgeSurface} style={[styles.menuKey, { backgroundColor: colors.surface }]} testID="mentor-menu-report">
                <Text style={[type.bodySemi, { color: colors.ink }]}>{t('mentor.chat.report')}</Text>
              </PressKey>
              <PressKey onPress={() => setMenu('confirmEnd')} edge={colors.edgeSurface} style={[styles.menuKey, { backgroundColor: colors.surface }]} testID="mentor-menu-end">
                <Text style={[type.bodySemi, { color: colors.danger }]}>{t('mentor.chat.end')}</Text>
              </PressKey>
            </>
          ) : (
            <>
              <Text style={[type.label, { color: colors.ink }]}>{t('mentor.chat.endTitle')}</Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentor.chat.endBody')}</Text>
              <View style={styles.menuRow}>
                <PressKey onPress={() => void endNow()} disabled={ending} edge={colors.accentEdge} style={[styles.menuKey, { backgroundColor: colors.accent }]} containerStyle={{ flex: 1 }} testID="mentor-end-confirm">
                  <Text style={[type.bodySemi, { color: colors.onAccent }]}>{t('mentor.chat.endConfirm')}</Text>
                </PressKey>
                <PressKey onPress={() => setMenu('closed')} disabled={ending} edge={colors.edgeSurface} style={[styles.menuKey, { backgroundColor: colors.surface }]} containerStyle={{ flex: 1 }} testID="mentor-end-cancel">
                  <Text style={[type.bodySemi, { color: colors.ink }]}>{t('mentor.chat.keep')}</Text>
                </PressKey>
              </View>
            </>
          )}
        </View>
      ) : null}

      {crisis ? <CrisisCard crisis={crisis} onDismiss={() => setCrisis(null)} /> : null}

      {error ? (
        <View style={styles.center}>
          <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>{t('mentor.chat.errOpen')}</Text>
          <PressKey onPress={() => setAttempt((a) => a + 1)} edge={colors.edgeSurface} style={[styles.menuKey, { backgroundColor: colors.surface }]} testID="mentor-chat-retry">
            <Text style={[type.bodySemi, { color: colors.ink }]}>{t('mentor.chat.retry')}</Text>
          </PressKey>
        </View>
      ) : channel ? (
        <View style={{ flex: 1 }} testID="mentor-chat-ready">
          <Chat client={getListenerStreamClient()} style={streamTheme}>
            <Channel channel={channel}>
              <MessageList />
              <MentorRail onHelplines={() => router.push('/mentor/helplines')} onReport={() => router.push({ pathname: '/mentor/report', params: { id: conversationId ?? '' } })} />
              <MessageComposer />
            </Channel>
          </Chat>
        </View>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[type.body, { color: colors.inkMuted }]}>{t('mentor.chat.opening')}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  personaName: { fontFamily: font.sansBold, fontSize: 18, lineHeight: 24 },
  menu: { margin: space.md, padding: space.sm, borderRadius: radius.lg, gap: space.xs },
  menuRow: { flexDirection: 'row', gap: space.sm },
  menuKey: { borderRadius: radius.md, padding: space.sm, alignItems: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.lg },
});
```

- [ ] **Step 5: Typecheck** — `npx tsc --noEmit` clean. (Web bundle is protected by Task 6's `.web.tsx`; until then the web route would import stream-chat-expo — do Task 6 before starting Expo web again, or keep the stub `.web.tsx` from Task 6 Step 1 in this commit.)

- [ ] **Step 6: Commit**
```bash
git add components/mentor app/mentor
git commit -m "feat(mobile): native mentor chat on the stream-chat-expo kit with the mentor rail, helplines sheet, report sheet, end confirm

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Web parity — `MentorChatScreen.web.tsx` + listener routes share it

**Files:**
- Create: `components/mentor/MentorChatScreen.web.tsx`
- Modify: `app/listener/chat/[id].tsx`, `components/listener/ListenerChatScreen.web.tsx` (delete after move), `components/listener/ListenerChatScreen.tsx` (delete)

- [ ] **Step 1: Move** `components/listener/ListenerChatScreen.web.tsx` → `components/mentor/MentorChatScreen.web.tsx` (`git mv`), rename the component to `MentorChatScreenWeb`, and:
  - route params: accept `id`, `channel`, `member`, `masked` (same as native);
  - header: add the `⋯` button (`mentor-chat-menu`) and the same open/confirmEnd strip as native (copy the JSX from Task 5; the web thread keeps its hand-rolled bubbles);
  - render `<MentorRail …>` between the message list and the composer;
  - the back button goes to `/mentor-home` when the app holds a member session, else `/listener` (check `getSessionToken()` once on mount: `const [home, setHome] = useState('/listener'); useEffect(() => { void getSessionToken().then((tok) => tok && setHome('/mentor-home')); }, []);`);
  - replace the hardcoded English strings with `t('mentor.chat.*')` keys from Task 2; keep testIDs `listener-chat-ready`, `listener-composer-input`, `listener-composer-send` (the `two-party-chat` e2e relies on them) and ADD `mentor-chat-ready` on the same ready container.
- [ ] **Step 2:** `app/listener/chat/[id].tsx` → `export { default } from '@/components/mentor/MentorChatScreen';`. Delete `components/listener/ListenerChatScreen.tsx` (native stub) — native listener routes now render the real chat; `app/listener/index.tsx` keeps rendering `ListenerConsole` (web) / `WebOnlyNotice` (native) unchanged.
- [ ] **Step 3:** `grep -rn "ListenerChatScreen" apps/mobile --include=*.ts --include=*.tsx` → empty. `npx tsc --noEmit` clean. Restart Expo `-c`; open `/listener` dev picker → a conversation → rail + menu visible, send works.
- [ ] **Step 4: Commit**
```bash
git add -A components/listener components/mentor app/listener
git commit -m "feat(web): mentor chat parity — rail + report/end menu on the web console, shared MentorChatScreen

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Proof — `e2e/mentor-console.e2e.js`, existing specs, docs

**Files:**
- Create: `e2e/mentor-console.e2e.js`
- Modify: `e2e/README.md`, `CLAUDE.md` (layout: `components/mentor/`, `app/mentor/`; e2e list), `PROGRESS.md`, `docs/DECISIONS.md` §K.9, `docs/PRIVACY.md` (one line: mentors can report a conversation; the report carries the conversation id and reason only)

- [ ] **Step 1: Write the spec** (plain Node, copy the header conventions from `e2e/role-fork.e2e.js`). Requires `MENTO_ADMIN_TOKEN` (mint: `cd services/api; python -m scripts.issue_admin_token --owner --name e2e`). Flow, in one browser with three contexts:

```js
/** Native mentor console proof (spec 2026-09-05). Requires MENTO_ADMIN_TOKEN.
 *  A: mentor — role fork → listen → apply; admin approves via API; Mentor Home shows
 *     the console; toggles online.
 *  B: member — onboards, browses mentors, sends a Personal request to A's persona.
 *  A: accepts → conversation row → opens chat → rail visible → replies.
 *  B: sees the reply.  A: Report sheet files; End frees the seat (console shows Ended).
 *  Reduced-motion pass repeats A's console + chat open. 0 page errors everywhere. */
const { chromium } = require('playwright');
const WEB = 'http://localhost:8081';
const API = 'http://localhost:8000/api/v1';
const ADMIN = process.env.MENTO_ADMIN_TOKEN;
if (!ADMIN) { console.error('MENTO_ADMIN_TOKEN required'); process.exit(2); }
const errors = [];
const ctxOpts = (reduced) => ({ viewport: { width: 390, height: 844 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });

async function mentorApply(page, tid) {
  await page.goto(WEB, { waitUntil: 'networkidle', timeout: 180000 });
  await tid('start').click();
  await tid('role-listen').click();
  await page.waitForSelector('text=How old are you?', { timeout: 60000 });
  await tid('continue').click();
  await page.waitForSelector('text=Optional, but helpful.', { timeout: 30000 });
  await tid('skip').click();
  await tid('primer-continue').click();           // PrimerStep → HandoffStep → Mentor Home
  await page.waitForSelector('[data-testid="mentor-home"]', { timeout: 60000 });
  await tid('application-motivation').fill('I have walked the UPSC road twice and know how lonely the wait after prelims gets.');
  await tid('community-upsc').click();
  await tid('availability-most_evenings').click();
  await tid('pledge').click();
  await tid('application-submit').click();
  await page.waitForSelector('[data-testid="mentor-status"]', { timeout: 30000 });
}

async function approveLatest() {
  const auth = { Authorization: `Bearer ${ADMIN}` };
  const list = await (await fetch(`${API}/admin/applications?status=pending`, { headers: auth })).json();
  const app = list[list.length - 1];
  const r = await fetch(`${API}/admin/applications/${app.id}/approve`, { method: 'POST', headers: auth });
  if (!r.ok) throw new Error(`approve failed ${r.status}`);
  return (await r.json()).persona_name;
}

async function memberOnboard(page, tid) { /* copy onboardMember from two-party-chat.e2e.js */ }

(async () => {
  const browser = await chromium.launch({ headless: true });
  const A = await browser.newContext(ctxOpts(false)); const a = await A.newPage(); a.on('pageerror', (e) => errors.push('A ' + e));
  const atid = (id) => a.locator(`[data-testid="${id}"]`);
  await mentorApply(a, atid);
  const personaName = await approveLatest();
  await a.reload({ waitUntil: 'networkidle' });
  await a.waitForSelector('[data-testid="mentor-console"]', { timeout: 60000 });
  await atid('mentor-status-toggle').click();
  await a.waitForSelector('text=Online', { timeout: 15000 });
  console.log('OK mentor console + online');

  const B = await browser.newContext(ctxOpts(false)); const b = await B.newPage(); b.on('pageerror', (e) => errors.push('B ' + e));
  const btid = (id) => b.locator(`[data-testid="${id}"]`);
  await memberOnboard(b, btid);
  await b.goto(`${WEB}/mentors`, { waitUntil: 'networkidle' });
  await b.locator(`text=${personaName}`).first().click();
  await btid('start-conversation').click();
  await btid('intro-input').fill('Exam stress, cannot sleep before prelims.');
  await btid('send-request').click();
  await b.waitForSelector('[data-testid="request-sent"]', { timeout: 30000 });
  console.log('OK personal request sent');

  await a.reload({ waitUntil: 'networkidle' });
  await a.waitForSelector('[data-testid^="mentor-request-"]', { timeout: 60000 });
  await a.locator('[data-testid^="mentor-accept-"]').first().click();
  await a.waitForSelector('[data-testid^="mentor-convo-"]', { timeout: 30000 });
  await a.locator('[data-testid^="mentor-convo-"]').first().click();
  await a.waitForSelector('[data-testid="mentor-chat-ready"]', { timeout: 60000 });
  await a.waitForSelector('[data-testid="mentor-rail"]', { timeout: 15000 });
  await atid('listener-composer-input').fill('I am here. Tell me about the nights.');
  await atid('listener-composer-send').click();
  await b.goto(`${WEB}/chats`, { waitUntil: 'networkidle' });
  await b.locator('[data-testid^="chat-row-"],[data-testid^="convo-"]').first().click().catch(() => {});
  await b.waitForSelector('text=I am here. Tell me about the nights.', { timeout: 30000 });
  console.log('OK mentor reply delivered');

  await atid('mentor-report').click();
  await a.waitForSelector('[data-testid="mentor-report-sheet"]', { timeout: 15000 });
  await atid('report-reason-spam').click();
  await atid('report-submit').click();
  await a.waitForSelector('[data-testid="mentor-report-sent"]', { timeout: 15000 });
  await atid('mentor-report-done').click();
  await atid('mentor-chat-menu').click();
  await atid('mentor-menu-end').click();
  await atid('mentor-end-confirm').click();
  await a.waitForSelector('[data-testid="mentor-console"]', { timeout: 30000 });
  await a.waitForSelector('text=Ended', { timeout: 30000 });
  console.log('OK report filed, conversation ended, seat freed');

  // Reduced motion: the console and chat still open, static.
  const R = await browser.newContext(ctxOpts(true)); const r = await R.newPage(); r.on('pageerror', (e) => errors.push('R ' + e));
  const state = await A.storageState();
  await R.addCookies(state.cookies);
  await r.goto(WEB + '/mentor-home', { waitUntil: 'networkidle' });
  await r.evaluate((s) => { for (const o of s) localStorage.setItem(o.name, o.value); }, state.origins[0]?.localStorage ?? []);
  await r.reload({ waitUntil: 'networkidle' });
  await r.waitForSelector('[data-testid="mentor-console"]', { timeout: 60000 });
  console.log('OK reduced-motion console');

  await browser.close();
  if (errors.length) { console.error('PAGE ERRORS', errors); process.exit(1); }
  console.log('\nMENTOR CONSOLE E2E PASSED — 0 page errors (normal + reduced-motion)');
})().catch((e) => { console.error('MENTOR CONSOLE FAILED', e.message, errors); process.exit(1); });
```
Adjust testIDs to the real ones in `ApplicationForm.tsx`, `PrimerStep.tsx` and the member Chats list (`grep -n testID` on each) before running; the member `/chats` row id and the `role-listen` id must match what `role-fork.e2e.js` already uses.

- [ ] **Step 2: Run** — reset (FLUSHDB + capacity), then `$env:NODE_PATH="C:\Users\khana\.claude\skills\playwright-skill\node_modules"; $env:MENTO_ADMIN_TOKEN="<token>"; node e2e/mentor-console.e2e.js` → PASSED, 0 page errors. Then re-run `role-fork`, `two-party-chat` (with its LISTENER_ID setup) and `member-screens` → green.
- [ ] **Step 3: Native hand-proof on Expo Go** (document the result in PROGRESS; not automatable): console renders, chat sends/receives with a web member, crisis card renders when the webhook tunnel is up (optional), helplines open the dialer, Report and End work, no boot crash (patches untouched).
- [ ] **Step 4: Docs** — `e2e/README.md` (new spec + `MENTO_ADMIN_TOKEN`), `CLAUDE.md` (layout rows for `components/mentor/`, `app/mentor/`; e2e list; SCOPE 13 already updated by Plan 1), `PROGRESS.md` session entry (Done per commit, proofs, deviations, open), `docs/DECISIONS.md` §K.9 (mark the native console shipped; note the `Panda Pause` copy question remains open), `docs/PRIVACY.md` one-line mentor-report disclosure.
- [ ] **Step 5: Commit**
```bash
git add e2e/mentor-console.e2e.js e2e/README.md CLAUDE.md PROGRESS.md docs/DECISIONS.md docs/PRIVACY.md
git commit -m "test(e2e): mentor console proof; docs: native mentor console shipped

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review against the spec

- §3 device side: T1 (SecureStore branch, session-lost signal, Start Fresh clears, disconnect), T4 (`ensureConsole` mints and stores; 403 → unavailable card + retry; nothing cached as trust) ✔.
- §4 console layout: T4 (PresenceHeader, RequestCard with 3-line expand + 409 note, ConversationRow with typing/preview/masked/ended/unread, Switch to talking retained), T3 (focus refresh, 30 s poll, Stream events, loading/error/empty) ✔.
- §5 chat: T5 native (kit, member header + Masked chip, CrisisCard dedupe, rail, helplines tel:, report sheet reason enum + ≤300 note, end confirm, errors still), T6 web parity + shared component ✔. transparentModal routes, never RN `<Modal>` ✔.
- §6 presence: T3 heartbeat hook (focus + online, 5 min), `sweptAway` copy key exists (T2) — shown by PresenceHeader when the server reports `away` after the client believed `online`: add in T4 `ConsoleBody` a `useRef` of the last known status and render `t('mentor.sweptAway')` under the presence line when it flips online→away without a local toggle (implementer: one `prevStatus` ref, one conditional `Text`, testID `mentor-swept`).
- §8 file plan: all files present in tasks ✔. §9 e2e: T7 ✔. §11 docs: T7 ✔.
- Type consistency: `listenerApi.report(id, reason, note)` (T1) ↔ `app/mentor/report.tsx` (T5); `ListenerReportReason` exported from `listenerApi` and used in T5; `ChannelLive` from `useMentorConsole` used by `ConversationRow`; `useListenerHeartbeat(enabled: boolean)` called with `me?.status === 'online'`; route params `{ id, channel, member, masked }` written by `ConversationRow`'s `onPress` in T4 and read by both chat screens.
- No placeholders: the only "copy from" instruction (member onboarding helper in the e2e) names the exact function and file it comes from.

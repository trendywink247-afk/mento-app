import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconBadge } from '@/components/IconBadge';
import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { ApiError } from '@/lib/api';
import {
  listenerApi,
  type DevListenerItem,
  type ListenerConversation,
  type ListenerMe,
  type ListenerRequest,
} from '@/lib/listenerApi';
import { getListenerToken, saveListenerToken } from '@/lib/listenerSession';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/**
 * The minimal listener console (DECISIONS §I.6) — web-only. A listener opens their
 * token link, sees their pending Personal requests and conversations, toggles their
 * availability, and replies from the chat screen. Members appear as PERSONAS only.
 */
export default function ListenerConsoleWeb() {
  const router = useRouter();
  const { colors, elevation } = useTheme();
  const params = useLocalSearchParams<{ token?: string }>();

  const [me, setMe] = useState<ListenerMe | null>(null);
  const [requests, setRequests] = useState<ListenerRequest[]>([]);
  const [convos, setConvos] = useState<ListenerConversation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Dev-only picker: seeded listeners to click when /listener has no token.
  const [devRoster, setDevRoster] = useState<DevListenerItem[] | null>(null);

  const refresh = useCallback(async () => {
    try {
      const token = await getListenerToken();
      if (!token) {
        // In dev, offer a click-to-enter picker instead of the dead-end error.
        // (The dev endpoints 404 in prod, so this silently no-ops there.)
        if (__DEV__) {
          try {
            setDevRoster(await listenerApi.devRoster());
            return;
          } catch {
            /* not dev / endpoint absent — fall through to the normal message */
          }
        }
        setError('No listener session. Open your console link again.');
        return;
      }
      const meData = await listenerApi.me();
      const [reqs, cons] = await Promise.all([listenerApi.requests(), listenerApi.conversations()]);
      setMe(meData);
      setRequests(reqs);
      setConvos(cons);
      setError(null);
      setDevRoster(null);
    } catch (e) {
      setError(
        e instanceof ApiError && (e.status === 401 || e.status === 403)
          ? 'This console link is invalid, expired, or revoked. Ask for a fresh one.'
          : 'Could not reach Mento. Check your connection and retry.',
      );
    }
  }, []);

  /** Dev picker: mint a token for the chosen listener, store it, enter the console. */
  const enterAsDev = useCallback(
    async (id: string) => {
      setBusy(id);
      try {
        const { token } = await listenerApi.devToken(id);
        await saveListenerToken(token);
        setDevRoster(null);
        await refresh();
      } catch {
        setToast("Couldn't open that console. Try again.");
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const boot = useCallback(async () => {
    // Prefer the #token= fragment — fragments never reach servers, proxies, or
    // access logs. ?token= stays supported as a fallback for older links.
    const hashMatch = window.location.hash.match(/[#&]token=([^&]+)/);
    const hashToken = hashMatch?.[1] ? decodeURIComponent(hashMatch[1]) : null;
    if (hashToken) {
      await saveListenerToken(hashToken);
      // Clear the fragment from the URL/history immediately — BOTH in the browser
      // and in expo-router's own state (which would otherwise re-sync the old URL
      // with the fragment back into the address bar).
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      router.replace('/listener');
    } else if (params.token) {
      await saveListenerToken(params.token);
      // Strip the token from the URL/history immediately.
      router.replace('/listener');
    }
    await refresh();
    // reason: params.token is consumed once and stripped; re-running on param
    // change would loop through router.replace
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  useEffect(() => {
    void boot();
    // Opening a NEW console link while this page is already mounted is a hash-only
    // change (no remount) — consume the fresh token instead of ignoring it.
    const onHash = () => void boot();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [boot]);

  const toggleStatus = async () => {
    if (!me) return;
    const next = me.status === 'online' ? 'away' : 'online';
    setMe(await listenerApi.setStatus(next));
  };

  const act = async (id: string, action: 'accept' | 'decline') => {
    setBusy(id);
    setToast(null);
    try {
      if (action === 'accept') await listenerApi.accept(id);
      else await listenerApi.decline(id);
      await refresh();
    } catch (e) {
      setToast(
        e instanceof ApiError && e.status === 409
          ? "You're at capacity — end a conversation before accepting another."
          : 'That didn’t work. Try again.',
      );
    } finally {
      setBusy(null);
    }
  };

  const openChat = (c: ListenerConversation) => {
    if (c.status === 'wiped' || !c.stream_channel_id) return; // channel is gone
    router.push({
      pathname: '/listener/chat/[id]',
      params: { id: c.id, channel: c.stream_channel_id, member: c.user_persona_name },
    });
  };

  const online = me?.status === 'online';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      {devRoster && !me ? (
        <ScrollView contentContainerStyle={styles.body} testID="console-dev-picker">
          <View style={[styles.header, { backgroundColor: colors.surface }, elevation.sm]}>
            <IconBadge icon="construct-outline" size={44} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: colors.ink }]}>Pick a listener</Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>
                Dev shortcut · real listeners use their private link
              </Text>
            </View>
          </View>
          {devRoster.map((li) => (
            <Pressable
              key={li.id}
              onPress={() => void enterAsDev(li.id)}
              accessibilityRole="button"
              accessibilityLabel={`Enter console as ${li.persona_name}`}
              testID={`dev-listener-${li.id}`}
              disabled={busy !== null}
              style={[styles.pickerRow, { backgroundColor: colors.surface }, elevation.sm]}
            >
              <PersonaAvatar name={li.persona_name} size={44} online={li.status === 'online'} />
              <View style={{ flex: 1 }}>
                <Text style={[type.label, { color: colors.ink }]}>{li.persona_name}</Text>
                <Text style={[type.caption, { color: colors.inkMuted }]}>{li.status}</Text>
              </View>
              {busy === li.id ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
              )}
            </Pressable>
          ))}
          {toast ? (
            <Text style={[type.caption, { color: colors.danger, textAlign: 'center' }]}>{toast}</Text>
          ) : null}
        </ScrollView>
      ) : error ? (
        <View style={styles.center} testID="console-error">
          <Ionicons name="key-outline" size={36} color={colors.inkMuted} />
          <Text style={[type.body, { color: colors.ink, textAlign: 'center' }]}>{error}</Text>
          {/* boot, not refresh: a freshly pasted #token= link must be consumed. */}
          <Pressable onPress={() => void boot()} accessibilityRole="button" testID="console-retry">
            <Text style={[type.label, { color: colors.accent }]}>Retry</Text>
          </Pressable>
        </View>
      ) : !me ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[type.body, { color: colors.inkMuted }]}>Opening your console…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.body} testID="console-ready">
          {/* Identity + availability */}
          <View style={[styles.header, { backgroundColor: colors.surface }, elevation.sm]}>
            <PersonaAvatar name={me.persona_name} size={56} online={online} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: colors.ink }]}>{me.persona_name}</Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>
                Listener console · {me.active_conversations}/{me.max_concurrent} conversations
              </Text>
            </View>
            <Pressable
              onPress={() => void toggleStatus()}
              accessibilityRole="button"
              accessibilityLabel={online ? 'Set yourself away' : 'Set yourself online'}
              testID="status-toggle"
              style={[
                styles.statusPill,
                { backgroundColor: online ? colors.accentTint : colors.surfaceAlt },
              ]}
            >
              <View
                style={[styles.dot, { backgroundColor: online ? colors.success : colors.warning }]}
              />
              <Text style={[type.label, { color: colors.ink }]}>{online ? 'Online' : 'Away'}</Text>
            </Pressable>
          </View>

          <View style={[styles.note, { backgroundColor: colors.brandTint }]}>
            <Ionicons name="shield-checkmark" size={14} color={colors.accent} />
            <Text style={[type.caption, { color: colors.ink, flex: 1 }]}>
              You're supporting anonymous members. Be kind, listen first, and never ask for
              personal details. You're a listener, not a therapist.
            </Text>
          </View>

          {toast ? (
            <View style={[styles.toastRow, { backgroundColor: colors.surfaceAlt }]} testID="console-toast">
              <Text style={[type.caption, { color: colors.ink }]}>{toast}</Text>
            </View>
          ) : null}

          {/* Pending Personal requests */}
          <Text style={[styles.section, { color: colors.ink }]}>Requests for you</Text>
          {requests.length === 0 ? (
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              No pending requests right now.
            </Text>
          ) : (
            requests.map((r) => (
              <View
                key={r.id}
                style={[styles.card, { backgroundColor: colors.surface }, elevation.sm]}
                testID={`request-${r.id}`}
              >
                <View style={styles.cardHead}>
                  <PersonaAvatar name={r.requester_persona_name} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={[type.bodySemi, { color: colors.ink }]}>
                      {r.requester_persona_name}
                    </Text>
                    {r.issue_category ? (
                      <View style={[styles.chip, { backgroundColor: colors.accentTint }]}>
                        <Text style={[type.caption, { color: colors.ink }]}>{r.issue_category}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                {r.intro_message ? (
                  <Text style={[type.body, { color: colors.ink }]}>“{r.intro_message}”</Text>
                ) : null}
                <View style={styles.actions}>
                  <Pressable
                    onPress={() => void act(r.id, 'accept')}
                    disabled={busy === r.id}
                    accessibilityRole="button"
                    testID={`accept-${r.id}`}
                    style={[styles.acceptBtn, { backgroundColor: colors.accent }]}
                  >
                    <Text style={[type.label, { color: colors.onAccent }]}>Accept</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void act(r.id, 'decline')}
                    disabled={busy === r.id}
                    accessibilityRole="button"
                    testID={`decline-${r.id}`}
                    style={[styles.declineBtn, { borderColor: colors.border }]}
                  >
                    <Text style={[type.label, { color: colors.inkMuted }]}>Decline</Text>
                  </Pressable>
                </View>
              </View>
            ))
          )}

          {/* Conversations */}
          <Text style={[styles.section, { color: colors.ink }]}>Your conversations</Text>
          {convos.length === 0 ? (
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              None yet — stay online and matches will find you.
            </Text>
          ) : (
            convos.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => openChat(c)}
                disabled={c.status === 'wiped'}
                accessibilityRole="button"
                testID={`convo-${c.id}`}
                style={[
                  styles.row,
                  { backgroundColor: colors.surface },
                  elevation.sm,
                  c.status !== 'active' && { opacity: 0.55 },
                ]}
              >
                <PersonaAvatar name={c.user_persona_name} size={44} online={c.status === 'active'} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.bodySemi, { color: colors.ink }]}>{c.user_persona_name}</Text>
                  <Text style={[type.caption, { color: colors.inkMuted }]}>
                    {c.status === 'active'
                      ? c.member_masked
                        ? 'Away right now'
                        : 'Active — tap to open'
                      : c.status === 'wiped'
                        ? 'Wiped by the member'
                        : 'Ended'}
                  </Text>
                </View>
                {c.status === 'active' ? (
                  <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
                ) : (
                  <IconBadge
                    icon={c.status === 'wiped' ? 'trash-outline' : 'checkmark-done-outline'}
                    size={32}
                  />
                )}
              </Pressable>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.lg },
  body: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.md,
  },
  name: { fontFamily: font.serifBold, fontSize: 20, lineHeight: 26 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.pill,
    paddingVertical: space.xs + 2,
    paddingHorizontal: space.sm + 2,
  },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.xs,
    borderRadius: radius.md,
    padding: space.sm,
  },
  toastRow: { borderRadius: radius.md, padding: space.sm },
  section: {
    fontFamily: font.serifBold,
    fontSize: 20,
    lineHeight: 26,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  card: { borderRadius: radius.lg, padding: space.md, gap: space.sm },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.md,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: space.sm,
    marginTop: 2,
  },
  actions: { flexDirection: 'row', gap: space.sm },
  acceptBtn: {
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineBtn: {
    borderRadius: radius.pill,
    borderWidth: 1.5,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.md,
  },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ConsolePressable } from '@/components/console/ConsolePressable';
import { adminApi, type AdminFlag, type AdminMessage } from '@/lib/adminApi';
import { formatTimestamp } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type, wash } from '@/theme/tokens';

type ReviewAction = 'helpline_shown' | 'escalated' | 'no_action';

/**
 * Crisis-flag review (T&S #1). Each inbound message our scan flagged surfaces here as
 * a SIGNAL only — never the body. The reviewer can open the conversation read-only to
 * see context, then record what happened (helpline shown / escalated / no action).
 */
export default function SafetyPanel({ onReviewed }: { onReviewed: () => void }) {
  const { colors, elevation } = useTheme();
  const [flags, setFlags] = useState<AdminFlag[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AdminMessage[] | null>(null);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await adminApi.flags(false);
        if (active) setFlags(data);
      } catch {
        if (active) setError('Could not load crisis flags. Retry shortly.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const toggleConversation = async (flag: AdminFlag) => {
    if (!flag.conversation_id) return;
    if (openId === flag.id) {
      setOpenId(null);
      setMessages(null);
      return;
    }
    setOpenId(flag.id);
    setMessages(null);
    setLoadingMsgs(true);
    try {
      setMessages(await adminApi.conversationMessages(flag.conversation_id));
    } catch {
      setError('Could not load that conversation.');
    } finally {
      setLoadingMsgs(false);
    }
  };

  const review = async (flag: AdminFlag, action: ReviewAction) => {
    setBusy(flag.id);
    setError(null);
    try {
      await adminApi.reviewFlag(flag.id, action);
      setFlags((prev) => (prev ? prev.filter((f) => f.id !== flag.id) : prev));
      if (openId === flag.id) {
        setOpenId(null);
        setMessages(null);
      }
      onReviewed();
    } catch {
      setError('That review did not save. Try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.body} testID="admin-panel-safety">
      {error ? <Text style={[type.caption, { color: colors.danger }]}>{error}</Text> : null}
      {!flags ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : flags.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="checkmark-circle-outline" size={40} color={colors.success} />
          <Text style={[type.body, { color: colors.inkMuted }]}>
            No crisis flags to review.
          </Text>
        </View>
      ) : (
        flags.map((flag) => (
          <View
            key={flag.id}
            style={[styles.card, { backgroundColor: colors.surface }, elevation.sm]}
            testID={`admin-flag-${flag.id}`}
          >
            <View style={styles.cardHead}>
              <View style={[styles.chip, { backgroundColor: wash.danger }]}>
                <Text style={[type.caption, { color: colors.danger }]}>{flag.signal}</Text>
              </View>
              <Text style={[type.caption, { color: colors.inkMuted }]}>
                {formatTimestamp(flag.created_at)}
              </Text>
            </View>

            <Text style={[type.body, { color: colors.ink }]}>
              {flag.member_persona ?? 'Member'} ↔ {flag.listener_persona ?? 'Listener'}
            </Text>

            {flag.conversation_id ? (
              <ConsolePressable
                onPress={() => void toggleConversation(flag)}
                accessibilityRole="button"
                accessibilityLabel={`${
                  openId === flag.id ? 'Hide' : 'Open'
                } conversation for ${flag.signal} flag from ${flag.member_persona ?? 'Member'}`}
                testID={`admin-flag-open-${flag.id}`}
                style={styles.openBtn}
              >
                <Ionicons
                  name={openId === flag.id ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.accent}
                />
                <Text style={[type.label, { color: colors.accent }]}>
                  {openId === flag.id ? 'Hide conversation' : 'Open conversation'}
                </Text>
              </ConsolePressable>
            ) : null}

            {openId === flag.id ? (
              <View style={[styles.thread, { backgroundColor: colors.surfaceAlt }]}>
                {loadingMsgs ? (
                  <ActivityIndicator color={colors.accent} />
                ) : messages && messages.length > 0 ? (
                  messages.map((m) => (
                    <View key={m.id} style={styles.bubble}>
                      <Text style={[type.caption, { color: colors.inkMuted }]}>
                        {m.user_persona} · {formatTimestamp(m.at)}
                      </Text>
                      <Text style={[type.body, { color: colors.ink }]}>{m.text}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={[type.caption, { color: colors.inkMuted }]}>
                    No messages to show.
                  </Text>
                )}
              </View>
            ) : null}

            <View style={styles.actions}>
              {(
                [
                  { label: 'Helpline shown', action: 'helpline_shown' as const },
                  { label: 'Escalated', action: 'escalated' as const },
                  { label: 'No action', action: 'no_action' as const },
                ]
              ).map((b) => (
                <ConsolePressable
                  key={b.action}
                  onPress={() => void review(flag, b.action)}
                  disabled={busy === flag.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${b.label} — ${flag.signal} flag from ${
                    flag.member_persona ?? 'Member'
                  }`}
                  testID={`admin-flag-${flag.id}-${b.action}`}
                  style={[styles.reviewBtn, { borderColor: colors.border }]}
                >
                  <Text style={[type.label, { color: colors.ink }]}>{b.label}</Text>
                </ConsolePressable>
              ))}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  card: { borderRadius: radius.lg, padding: space.md, gap: space.sm },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: space.sm,
  },
  openBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    alignSelf: 'flex-start',
    minHeight: 44,
  },
  thread: { borderRadius: radius.md, padding: space.sm, gap: space.sm },
  bubble: { gap: 2 },
  actions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  reviewBtn: {
    borderRadius: radius.pill,
    borderWidth: 1.5,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

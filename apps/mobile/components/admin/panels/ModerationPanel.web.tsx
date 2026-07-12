import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { adminApi, type AdminModerationItem } from '@/lib/adminApi';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

const LEVEL_LABELS: Record<number, string> = {
  1: 'Redirect',
  2: 'Warning',
  3: 'Suspension',
  4: 'Ban',
};

/**
 * Moderation queue (PRD §11). Reports and block events awaiting a human decision.
 * The reviewer can resolve an event or suspend the subject listener outright — the
 * suspension revokes their console token instantly (T&S #9).
 */
export default function ModerationPanel({ onResolved }: { onResolved: () => void }) {
  const { colors, elevation } = useTheme();
  const [events, setEvents] = useState<AdminModerationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await adminApi.moderationQueue();
        if (active) setEvents(data);
      } catch {
        if (active) setError('Could not load the moderation queue. Retry shortly.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const resolve = async (event: AdminModerationItem) => {
    setBusy(event.id);
    setError(null);
    try {
      await adminApi.resolveEvent(event.id);
      setEvents((prev) => (prev ? prev.filter((e) => e.id !== event.id) : prev));
      onResolved();
    } catch {
      setError('Could not resolve that report. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const suspend = async (event: AdminModerationItem) => {
    setBusy(event.id);
    setError(null);
    try {
      await adminApi.suspendListener(event.subject_id);
      setToast('Listener suspended');
    } catch {
      setError('Could not suspend that listener. Try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.body} testID="admin-panel-moderation">
      {error ? <Text style={[type.caption, { color: colors.danger }]}>{error}</Text> : null}
      {toast ? <Text style={[type.caption, { color: colors.ink }]}>{toast}</Text> : null}
      {!events ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : events.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="shield-checkmark-outline" size={40} color={colors.success} />
          <Text style={[type.body, { color: colors.inkMuted }]}>No reports to review.</Text>
        </View>
      ) : (
        events.map((event) => (
          <View
            key={event.id}
            style={[styles.card, { backgroundColor: colors.surface }, elevation.sm]}
            testID={`admin-moderation-${event.id}`}
          >
            <View style={styles.cardHead}>
              <View style={[styles.chip, { backgroundColor: colors.surfaceAlt }]}>
                <Text style={[type.caption, { color: colors.ink }]}>
                  {LEVEL_LABELS[event.level] ?? `Level ${event.level}`}
                </Text>
              </View>
              {event.blocked ? (
                <View style={[styles.chip, { backgroundColor: colors.surfaceAlt }]}>
                  <Text style={[type.caption, { color: colors.danger }]}>Blocked</Text>
                </View>
              ) : null}
            </View>

            <Text style={[type.body, { color: colors.ink }]}>
              {event.reason ?? 'No reason given'}
            </Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              Reporter {event.reporter_id ? event.reporter_id.slice(0, 8) : '—'} · Subject{' '}
              {event.subject_id.slice(0, 8)}
            </Text>

            <View style={styles.actions}>
              <Pressable
                onPress={() => void resolve(event)}
                disabled={busy === event.id}
                accessibilityRole="button"
                testID={`admin-moderation-${event.id}-resolve`}
                style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
              >
                <Text style={[type.label, { color: colors.onAccent }]}>Resolve</Text>
              </Pressable>
              <Pressable
                onPress={() => void suspend(event)}
                disabled={busy === event.id}
                accessibilityRole="button"
                testID={`admin-moderation-${event.id}-suspend`}
                style={[styles.secondaryBtn, { borderColor: colors.border }]}
              >
                <Text style={[type.label, { color: colors.danger }]}>Suspend listener</Text>
              </Pressable>
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
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: space.sm,
  },
  actions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  primaryBtn: {
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtn: {
    borderRadius: radius.pill,
    borderWidth: 1.5,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

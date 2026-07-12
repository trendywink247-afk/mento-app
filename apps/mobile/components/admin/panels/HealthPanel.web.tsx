import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { adminApi, type AdminHealth } from '@/lib/adminApi';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

const STALE_MS = 15 * 60 * 1000;

/**
 * System health at a glance — the core dependencies (db / redis / Stream config /
 * rate limiter) as green/red dots, plus the last inbound Stream webhook timestamp,
 * which goes RED if we haven't heard from Stream in 15 minutes (crisis scan path).
 */
export default function HealthPanel() {
  const { colors, elevation } = useTheme();
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await adminApi.health();
        if (active) setHealth(data);
      } catch {
        if (active) setError('Could not load system health. Retry shortly.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const dotColor = (ok: boolean) => (ok ? colors.success : colors.danger);

  const webhookStale =
    !health?.last_webhook_at ||
    Date.now() - new Date(health.last_webhook_at).getTime() > STALE_MS;

  return (
    <ScrollView contentContainerStyle={styles.body} testID="admin-panel-health">
      {error ? (
        <Text style={[type.caption, { color: colors.danger }]}>{error}</Text>
      ) : !health ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[type.body, { color: colors.inkMuted }]}>Checking systems…</Text>
        </View>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.surface }, elevation.sm]}>
          {(
            [
              { label: 'Database', ok: health.db_ok },
              { label: 'Redis', ok: health.redis_ok },
              { label: 'Stream configured', ok: health.stream_configured },
              { label: 'Rate limiter', ok: health.rate_limiter_ok },
            ] as const
          ).map((c) => (
            <View key={c.label} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: dotColor(c.ok) }]} />
              <Text style={[type.body, { color: colors.ink, flex: 1 }]}>{c.label}</Text>
              <Text style={[type.caption, { color: c.ok ? colors.success : colors.danger }]}>
                {c.ok ? 'OK' : 'Down'}
              </Text>
            </View>
          ))}
          <View style={styles.row}>
            <View style={[styles.dot, { backgroundColor: dotColor(!webhookStale) }]} />
            <Text style={[type.body, { color: colors.ink, flex: 1 }]}>Last Stream webhook</Text>
            <Text style={[type.caption, { color: webhookStale ? colors.danger : colors.inkMuted }]}>
              {health.last_webhook_at
                ? new Date(health.last_webhook_at).toLocaleString()
                : 'never'}
            </Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.xl },
  card: { borderRadius: radius.lg, padding: space.md, gap: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 10, height: 10, borderRadius: radius.pill },
});

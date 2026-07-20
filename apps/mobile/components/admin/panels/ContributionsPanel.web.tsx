import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { adminApi, type AdminContribution } from '@/lib/adminApi';
import { formatTimestamp } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/**
 * Contributions ledger (T&S #4 — honest money). Empty until Razorpay is wired; the
 * empty state says so plainly rather than implying revenue that doesn't exist yet.
 */
export default function ContributionsPanel() {
  const { colors, elevation } = useTheme();
  const [rows, setRows] = useState<AdminContribution[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const data = await adminApi.contributions();
        if (active) setRows(data);
      } catch {
        if (active) setError('Could not load contributions. Retry shortly.');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.body} testID="admin-panel-contributions">
      {error ? <Text style={[type.caption, { color: colors.danger }]}>{error}</Text> : null}
      {!rows && !error ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : rows && rows.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="cafe-outline" size={40} color={colors.inkMuted} />
          <Text style={[type.bodySemi, { color: colors.ink }]}>No contributions yet</Text>
          <Text style={[type.caption, { color: colors.inkMuted, textAlign: 'center' }]}>
            This fills in once Razorpay is wired.
          </Text>
        </View>
      ) : rows ? (
        <View style={[styles.card, { backgroundColor: colors.surface }, elevation.sm]}>
          <View style={[styles.row, styles.headRow, { borderColor: colors.border }]}>
            <Text style={[type.label, styles.colAmount, { color: colors.inkMuted }]}>Amount</Text>
            <Text style={[type.label, styles.colStatus, { color: colors.inkMuted }]}>Status</Text>
            <Text style={[type.label, styles.colDate, { color: colors.inkMuted }]}>Date</Text>
          </View>
          {rows.map((r) => (
            <View
              key={r.id}
              style={[styles.row, { borderColor: colors.border }]}
              testID={`admin-contribution-${r.id}`}
            >
              <Text style={[type.body, styles.colAmount, { color: colors.ink }]}>
                ₹{(r.amount_paise / 100).toFixed(2)}
              </Text>
              <Text style={[type.body, styles.colStatus, { color: colors.ink }]}>{r.status}</Text>
              <Text style={[type.body, styles.colDate, { color: colors.inkMuted }]}>
                {formatTimestamp(r.created_at)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  center: { alignItems: 'center', justifyContent: 'center', gap: space.sm, padding: space.xl },
  card: { borderRadius: radius.lg, padding: space.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
  },
  headRow: { borderBottomWidth: 1.5 },
  colAmount: { flex: 1, textAlign: 'right', fontVariant: ['tabular-nums'] },
  colStatus: { flex: 1 },
  colDate: { flex: 1 },
});

/**
 * Earnings and Opportunities on the mentor's profile (DECISIONS T.5). Stubs from day one of
 * testing: the balance stays ₹0 until payments are approved, the counts are real, and the
 * paid features are marked Soon. A failed load shows the zero card rather than an error.
 */
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { useI18n } from '@/lib/i18n';
import { listenerApi, type Earnings } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

const ZERO: Earnings = {
  balance_paise: 0,
  currency: 'INR',
  payments_live: false,
  evaluation_requests: 0,
  completed_evaluations: 0,
  mentorship_sessions: 0,
  personal_requests: 0,
};

export function EarningsCard() {
  const { colors } = useTheme();
  const { t } = useI18n();
  const router = useRouter();
  const [e, setE] = useState<Earnings>(ZERO);
  const live = Boolean(e.evaluations_live);

  useEffect(() => {
    let live = true;
    listenerApi
      .earnings()
      .then((x) => live && setE(x))
      .catch(() => {
        /* reason: an older server has no earnings yet; the zero card is true for it */
      });
    return () => {
      live = false;
    };
  }, []);

  const rupees = `₹${Math.floor(e.balance_paise / 100).toLocaleString('en-IN')}`;
  const stats = [
    { v: e.evaluation_requests, l: t('earnings.requests') },
    { v: e.completed_evaluations, l: t('earnings.completed') },
    { v: e.mentorship_sessions, l: t('earnings.sessions') },
  ];
  const opps: { icon: keyof typeof Ionicons.glyphMap; label: string; soon: boolean; right?: string; go?: () => void }[] = [
    live
      ? {
          icon: 'cloud-upload-outline',
          label: t('earnings.evalRequests'),
          soon: false,
          right: t('earnings.evalWaiting', { count: e.evaluation_requests }),
          go: () => router.push('/mentor/evaluations'),
        }
      : { icon: 'cloud-upload-outline', label: t('earnings.evalRequests'), soon: true },
    { icon: 'link-outline', label: t('earnings.link'), soon: true },
    { icon: 'calendar-outline', label: t('earnings.paid'), soon: true },
    {
      icon: 'receipt-outline',
      label: t('earnings.history'),
      soon: false,
      // A record of what returned evaluations would have paid; nothing is paid yet.
      right: e.evaluation_paise ? t('earnings.recorded', { amount: `₹${Math.floor(e.evaluation_paise / 100).toLocaleString('en-IN')}` }) : t('earnings.historyEmpty'),
    },
  ];

  return (
    <View style={styles.wrap} testID="mentor-earnings">
      <Text style={[styles.group, { color: colors.inkMuted }]} accessibilityRole="header">{t('earnings.title')}</Text>
      <EdgeSurface edge={colors.edgeSurface} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <Text style={[type.caption, { color: colors.inkMuted }]}>{t('earnings.balance')}</Text>
        <Text style={[styles.balance, { color: colors.ink }]} testID="mentor-earnings-balance">{rupees}</Text>
        <Text style={[type.caption, { color: colors.inkMuted }]}>{t('earnings.note')}</Text>
        <View style={styles.stats}>
          {stats.map((s) => (
            <View key={s.l} style={[styles.stat, { backgroundColor: colors.surfaceAlt }]}>
              <Text style={[styles.statValue, { color: colors.ink }]}>{s.v}</Text>
              <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={2}>{s.l}</Text>
            </View>
          ))}
        </View>
      </EdgeSurface>
      <Text style={[styles.group, { color: colors.inkMuted }]} accessibilityRole="header">{t('earnings.opportunities')}</Text>
      <EdgeSurface edge={colors.edgeSurface} style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {opps.map((o, i) => (
          <Pressable
            key={o.label}
            onPress={o.go}
            disabled={!o.go}
            accessibilityRole={o.go ? 'button' : undefined}
            testID={o.go ? 'earnings-open-evaluations' : undefined}
            style={[styles.row, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}
          >
            <Ionicons name={o.icon} size={20} color={colors.accentInk} />
            <Text style={[type.body, styles.grow, { color: colors.ink }]}>{o.label}</Text>
            {o.soon ? (
              <Text style={[styles.soon, { color: colors.inkMuted, backgroundColor: colors.surfaceAlt }]}>{t('earnings.soon')}</Text>
            ) : (
              <Text style={[type.caption, { color: colors.inkMuted }]}>{o.right}</Text>
            )}
            {o.go ? <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} /> : null}
          </Pressable>
        ))}
      </EdgeSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  group: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18, letterSpacing: 0.3, marginTop: space.sm, marginLeft: 4 },
  card: { padding: space.md, gap: 2, borderWidth: 1, borderRadius: radius.lg },
  balance: { fontFamily: font.sansBold, fontSize: 32, lineHeight: 40 },
  stats: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  stat: { flex: 1, borderRadius: radius.md, padding: 10, gap: 2 },
  statValue: { fontFamily: font.sansBold, fontSize: 18, lineHeight: 24 },
  list: { borderWidth: 1, borderRadius: radius.lg, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14 },
  grow: { flex: 1 },
  soon: { fontFamily: font.sansBold, fontSize: 11, lineHeight: 14, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, overflow: 'hidden' },
});

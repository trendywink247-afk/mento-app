import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { adminApi, type AdminMe, type AdminOverview } from '@/lib/adminApi';
import { getAdminToken, saveAdminToken } from '@/lib/adminSession';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

import AdminsPanel from './panels/AdminsPanel.web';
import ContributionsPanel from './panels/ContributionsPanel.web';
import HealthPanel from './panels/HealthPanel.web';
import ListenersPanel from './panels/ListenersPanel.web';
import ModerationPanel from './panels/ModerationPanel.web';
import OverviewPanel from './panels/OverviewPanel.web';
import SafetyPanel from './panels/SafetyPanel.web';

/**
 * Admin dashboard shell (spec 2026-07-13) — web-only. Token-link auth mirrors the
 * listener console (#token= fragment → saved → stripped; per-request revocation is
 * server-side). Cockpit: top tabs, Overview landing, unreviewed badges on Safety /
 * Moderation. The Admins tab is owner-only.
 */
const TABS = [
  'Overview',
  'Safety',
  'Moderation',
  'Listeners',
  'Contributions',
  'Health',
  'Admins',
] as const;
type Tab = (typeof TABS)[number];

export default function AdminConsoleWeb() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const { colors, elevation } = useTheme();

  const [me, setMe] = useState<AdminMe | null>(null);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [tab, setTab] = useState<Tab>('Overview');
  const [error, setError] = useState<string | null>(null);

  const loadOverview = useCallback(async () => {
    try {
      setOverview(await adminApi.overview());
    } catch {
      /* overview is best-effort; the tab panels still work */
    }
  }, []);

  const load = useCallback(async () => {
    try {
      if (!(await getAdminToken())) {
        setError('No admin session. Open your console link again.');
        return;
      }
      setMe(await adminApi.me());
      await loadOverview();
      setError(null);
    } catch {
      setError('This admin link is invalid, expired, or revoked. Ask the owner for a fresh one.');
    }
  }, [loadOverview]);

  const boot = useCallback(async () => {
    const hash = window.location.hash.match(/[#&]token=([^&]+)/);
    const token = hash?.[1] ? decodeURIComponent(hash[1]) : params.token;
    if (token) {
      await saveAdminToken(token);
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      router.replace('/admin');
    }
    await load();
    // reason: token is consumed once and stripped; re-running on param change loops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  useEffect(() => {
    void boot();
    const onHash = () => void boot();
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, [boot]);

  if (error) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <View style={styles.center} testID="admin-error">
          <Text style={[type.body, { color: colors.ink, textAlign: 'center' }]}>{error}</Text>
          <Pressable onPress={() => void boot()} accessibilityRole="button" testID="admin-retry">
            <Text style={[type.label, { color: colors.accent }]}>Retry</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!me) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={[type.body, { color: colors.inkMuted }]}>Opening the dashboard…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const visibleTabs = TABS.filter((t) => t !== 'Admins' || me.role === 'owner');
  const badge = (t: Tab): number =>
    (t === 'Safety'
      ? overview?.flags_unreviewed
      : t === 'Moderation'
        ? overview?.reports_unreviewed
        : 0) || 0;

  const goto = (href: string) => {
    const match = TABS.find((t) => t.toLowerCase() === href.toLowerCase());
    if (match) setTab(match);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} testID="admin-ready">
      <View style={[styles.tabbar, { backgroundColor: colors.surface }, elevation.sm]}>
        <Text style={[styles.brand, { color: colors.accent }]}>mento admin</Text>
        {visibleTabs.map((t) => (
          <Pressable
            key={t}
            onPress={() => setTab(t)}
            accessibilityRole="button"
            testID={`admin-tab-${t.toLowerCase()}`}
            style={[styles.tab, tab === t && { backgroundColor: colors.accentTint }]}
          >
            <Text style={[type.label, { color: tab === t ? colors.accent : colors.inkMuted }]}>
              {t}
              {badge(t) ? ` (${badge(t)})` : ''}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {tab === 'Overview' ? (
          <OverviewPanel overview={overview} onGoto={goto} />
        ) : tab === 'Safety' ? (
          <SafetyPanel onReviewed={loadOverview} />
        ) : tab === 'Moderation' ? (
          <ModerationPanel onResolved={loadOverview} />
        ) : tab === 'Listeners' ? (
          <ListenersPanel />
        ) : tab === 'Contributions' ? (
          <ContributionsPanel />
        ) : tab === 'Health' ? (
          <HealthPanel />
        ) : (
          <AdminsPanel />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, padding: space.lg },
  tabbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.xs,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  brand: { fontFamily: font.serifBold, fontSize: 18, marginRight: space.md },
  tab: { paddingVertical: space.xs, paddingHorizontal: space.md, borderRadius: radius.pill },
  body: { padding: space.lg, gap: space.sm, maxWidth: 1100, width: '100%', alignSelf: 'center' },
});

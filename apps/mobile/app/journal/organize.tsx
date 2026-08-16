import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { Screen } from '@/components/Screen';
import { ApiError, api, type OrganizeResult } from '@/lib/api';
import { useI18n, type TKey } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/**
 * Organize with AI — the opt-in note-sorting assistant (SCOPE §9). Only the user's own
 * reflective channels are sent; mentor-notes and chat are never organized (T&S #6/#7).
 * Dark by default: without a server key the endpoint 503s and we say so honestly.
 */
const CHANNELS: { key: string; title: TKey; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'mood', title: 'journals.moodTitle', icon: 'heart-outline' },
  { key: 'finance', title: 'journals.financeTitle', icon: 'wallet-outline' },
  { key: 'gratitude', title: 'journals.gratitudeTitle', icon: 'leaf-outline' },
];

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading'; channel: string }
  | { kind: 'result'; data: OrganizeResult }
  | { kind: 'error'; message: string };

export default function OrganizeScreen() {
  const router = useRouter();
  const { colors, elevation } = useTheme();
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });

  const run = async (channel: string) => {
    setPhase({ kind: 'loading', channel });
    try {
      const data = await api.organizeNotes(channel);
      setPhase({ kind: 'result', data });
    } catch (e) {
      const key: TKey =
        e instanceof ApiError && e.status === 503
          ? 'journals.organizeDisabled'
          : e instanceof ApiError && e.status === 400
            ? 'journals.organizeEmpty'
            : 'journals.organizeError';
      setPhase({ kind: 'error', message: t(key) });
    }
  };

  return (
    <Screen bg="lavender" onBack={() => router.back()} scroll>
      <View style={styles.head}>
        <IconBadge icon="sparkles" size={44} />
        <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
          {t('journals.organizeTitle')}
        </Text>
        <Text style={[type.caption, { color: colors.inkMuted }]}>{t('journals.organizeSub')}</Text>
      </View>

      <Text style={[styles.section, { color: colors.ink }]}>{t('journals.organizePick')}</Text>
      <View style={styles.chips}>
        {CHANNELS.map((c) => {
          const busy = phase.kind === 'loading' && phase.channel === c.key;
          return (
            <Pressable
              key={c.key}
              onPress={() => run(c.key)}
              disabled={phase.kind === 'loading'}
              accessibilityRole="button"
              testID={`organize-channel-${c.key}`}
              style={[styles.chip, { backgroundColor: colors.surface }, elevation.sm]}
            >
              <Ionicons name={c.icon} size={18} color={colors.accent} />
              <Text style={[styles.chipText, { color: colors.ink }]}>{t(c.title)}</Text>
              {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
            </Pressable>
          );
        })}
      </View>

      {phase.kind === 'loading' ? (
        <Text style={[type.caption, { color: colors.inkMuted }]}>{t('journals.organizeBusy')}</Text>
      ) : null}

      {phase.kind === 'error' ? (
        <View style={[styles.notice, { backgroundColor: colors.surfaceAlt }]} testID="organize-error">
          <Ionicons name="information-circle-outline" size={18} color={colors.accentSoft} />
          <Text style={[type.caption, { color: colors.inkMuted, flex: 1 }]}>{phase.message}</Text>
        </View>
      ) : null}

      {phase.kind === 'result' ? (
        <View testID="organize-result">
          {phase.data.overview ? (
            <View style={[styles.overview, { backgroundColor: colors.surface }, elevation.sm]}>
              <Text style={[type.body, { color: colors.ink }]}>{phase.data.overview}</Text>
            </View>
          ) : null}
          <Text style={[styles.section, { color: colors.ink }]}>{t('journals.organizeThemes')}</Text>
          {phase.data.themes.map((th, i) => (
            <View
              key={i}
              style={[styles.theme, { backgroundColor: colors.surface }, elevation.sm]}
            >
              <View style={styles.themeHead}>
                <Text style={[styles.themeTitle, { color: colors.ink }]}>{th.title}</Text>
                {th.count ? (
                  <View style={[styles.count, { backgroundColor: colors.surfaceAlt }]}>
                    <Text style={[styles.countText, { color: colors.accent }]}>{th.count}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[type.caption, { color: colors.inkMuted }]}>{th.summary}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: space.xs, marginBottom: space.md },
  title: { fontFamily: font.serif, fontSize: 26, lineHeight: 32, marginTop: space.xs },
  section: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 24, marginTop: space.md, marginBottom: space.sm },
  chips: { gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.sm + 2,
  },
  chipText: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 23, flex: 1 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.sm,
  },
  overview: { borderRadius: radius.lg, padding: space.md, marginBottom: space.xs },
  theme: { borderRadius: radius.lg, padding: space.md, marginBottom: space.sm, gap: space.xs },
  themeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  themeTitle: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 23 },
  count: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
  },
  countText: { fontFamily: font.sansBold, fontSize: 13 },
});

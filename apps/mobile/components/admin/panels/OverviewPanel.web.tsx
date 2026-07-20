import { Ionicons } from '@expo/vector-icons';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ConsolePressable } from '@/components/console/ConsolePressable';
import { type AdminOverview } from '@/lib/adminApi';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/**
 * Admin dashboard home — a row of at-a-glance stat tiles plus a "Needs attention"
 * list the owner can tap straight into. Presentational: the shell fetches the
 * overview and hands it down; safety/moderation counts turn red when non-zero.
 */
export default function OverviewPanel({
  overview,
  failed,
  onGoto,
}: {
  overview: AdminOverview | null;
  failed: boolean;
  onGoto: (tab: string) => void;
}) {
  const { colors, elevation } = useTheme();

  const tiles: { label: string; value: number; alert?: boolean }[] = overview
    ? [
        { label: 'Members today', value: overview.members_today },
        { label: 'Matches today', value: overview.matches_today },
        { label: 'Active conversations', value: overview.active_conversations },
        { label: 'Listeners online', value: overview.listeners_online },
        { label: 'Flags to review', value: overview.flags_unreviewed, alert: overview.flags_unreviewed > 0 },
        { label: 'Reports to review', value: overview.reports_unreviewed, alert: overview.reports_unreviewed > 0 },
      ]
    : [];

  return (
    <ScrollView contentContainerStyle={styles.body} testID="admin-panel-overview">
      <View style={styles.tiles}>
        {tiles.map((t) => (
          <View
            key={t.label}
            style={[styles.tile, { backgroundColor: colors.surface }, elevation.sm]}
          >
            <Text style={[styles.tileNum, { color: t.alert ? colors.danger : colors.ink }]}>
              {t.value}
            </Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{t.label}</Text>
          </View>
        ))}
      </View>

      <Text style={[styles.section, { color: colors.ink }]}>Needs attention</Text>
      {failed ? (
        <Text style={[type.caption, { color: colors.inkMuted }]}>
          Overview couldn&apos;t load. Retry from the header.
        </Text>
      ) : overview && overview.attention.length > 0 ? (
        overview.attention.map((item) => (
          <ConsolePressable
            key={`${item.kind}-${item.href}`}
            onPress={() => onGoto(item.href)}
            accessibilityRole="button"
            accessibilityLabel={item.text}
            testID={`admin-attention-${item.kind}`}
            style={[styles.row, { backgroundColor: colors.surface }, elevation.sm]}
            hoverStyle={{ backgroundColor: colors.surfaceAlt }}
          >
            <Ionicons name="alert-circle" size={20} color={colors.warning} />
            <Text style={[type.body, { color: colors.ink, flex: 1 }]}>{item.text}</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
          </ConsolePressable>
        ))
      ) : overview ? (
        <View style={[styles.clear, { backgroundColor: colors.surface }, elevation.sm]}>
          <Ionicons name="checkmark-circle" size={20} color={colors.success} />
          <Text style={[type.body, { color: colors.inkMuted }]}>
            All clear — nothing needs attention.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  tile: {
    minWidth: 160,
    flexGrow: 1,
    flexBasis: 160,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.xs,
  },
  tileNum: { ...type.stat, fontVariant: ['tabular-nums'] },
  section: {
    ...type.titleSmSerif,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.md,
  },
  clear: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.md,
  },
});

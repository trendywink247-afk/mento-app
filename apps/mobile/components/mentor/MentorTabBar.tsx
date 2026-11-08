import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EdgeSurface } from '@/components/EdgeSurface';
import { TAB_BAR_HEIGHT, TAB_DOCK_MIN_INSET } from '@/components/tabDock';

import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space } from '@/theme/tokens';

export type MentorTab = 'requests' | 'chats' | 'home' | 'profile';

const TABS: { key: MentorTab; icon: keyof typeof Ionicons.glyphMap; iconOn: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'requests', icon: 'mail-outline', iconOn: 'mail' },
  { key: 'chats', icon: 'chatbubble-outline', iconOn: 'chatbubble' },
  { key: 'home', icon: 'home-outline', iconOn: 'home' },
  { key: 'profile', icon: 'person-outline', iconOn: 'person' },
];

/**
 * The mentor side's bottom bar (founder reference, 2026-11-08): Requests with a count, Conversations,
 * Home, Profile. Plain state, not routes: the one `/mentor-home` route (and every push tap and old link
 * to it) stays as it is. The count is a number of waiting requests, never a name or any text.
 */
export function MentorTabBar({
  tab,
  onChange,
  requestCount,
}: {
  tab: MentorTab;
  onChange: (tab: MentorTab) => void;
  requestCount: number;
}) {
  const { colors, elevation } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const label = (k: MentorTab) =>
    k === 'requests'
      ? t('mentor.requestsTitle')
      : k === 'chats'
        ? t('mentor.tabChats')
        : k === 'home'
          ? t('mentor.tabHome')
          : t('mentor.tabProfile');
  // The member bar's own look (app/(tabs)/_layout.tsx): a white pill floating over the ground,
  // each tab a 48px cell with the icon over the label, the active one an accent-tint pillow.
  return (
    <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, TAB_DOCK_MIN_INSET) }]}>
      <View
        style={[styles.bar, elevation.md, { backgroundColor: colors.surface, borderColor: colors.border }]}
        accessibilityRole="tablist"
        testID="mentor-tabbar"
      >
        {TABS.map(({ key, icon, iconOn }) => {
          const focused = tab === key;
          const ink = focused ? colors.accent : colors.inkMuted;
          const count = key === 'requests' ? requestCount : 0;
          return (
            <Pressable
              key={key}
              style={styles.tab}
              onPress={() => onChange(key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={count ? `${label(key)}, ${count}` : label(key)}
              testID={`mentor-tab-${key}`}
            >
              <EdgeSurface
                key={focused ? 'on' : 'off'}
                edge={focused ? colors.accentTintEdge : 'transparent'}
                travel={3}
                radius={radius.pill}
                containerStyle={styles.cellBox}
                style={[styles.cell, { backgroundColor: focused ? colors.accentTint : 'transparent' }]}
              >
                <View>
                  <Ionicons name={focused ? iconOn : icon} size={22} color={ink} />
                  {count > 0 ? (
                    <View style={[styles.badge, { backgroundColor: colors.accent }]} testID="mentor-tab-requests-count">
                      <Text style={[styles.badgeText, { color: colors.onAccent }]} maxFontSizeMultiplier={1.2}>
                        {count > 9 ? '9+' : count}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.label, { color: ink }]} numberOfLines={1}>
                  {label(key)}
                </Text>
              </EdgeSurface>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // In the flow (the member bar floats over its screens): this screen ends at the bar's top edge.
  dock: { paddingHorizontal: space.md },
  bar: {
    height: TAB_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    padding: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  tab: { flex: 1 },
  cellBox: { alignSelf: 'stretch' },
  cell: { height: 48, alignItems: 'center', justifyContent: 'center', gap: 1 },
  label: { fontSize: 12, fontFamily: font.sansBold, lineHeight: 14 },
  badge: {
    position: 'absolute',
    top: -6,
    right: -10,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  badgeText: { fontSize: 11, lineHeight: 14, fontWeight: '700' },
});

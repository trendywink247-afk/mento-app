import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EdgeSurface } from '@/components/EdgeSurface';
import { TAB_BAR_HEIGHT, TAB_DOCK_MIN_INSET } from '@/components/tabDock';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space } from '@/theme/tokens';

export type TabPillItem = {
  key: string;
  label: string;
  /** Outline glyph when idle, filled when this tab is showing. */
  icon: keyof typeof Ionicons.glyphMap;
  iconOn: keyof typeof Ionicons.glyphMap;
  focused: boolean;
  onPress: () => void;
  /** A number only (waiting requests, unread chats), never text. 0 shows nothing. */
  count?: number;
  accessibilityLabel?: string;
  testID?: string;
};

/**
 * THE bottom bar, for the member side (app/(tabs)/_layout.tsx) and the mentor side
 * (components/mentor/MentorTabBar.tsx) alike: a pill floating over the ground, 16 in from the
 * sides, each tab a 48px cell with the icon over the label, the showing tab an accent-tint
 * pillow. One component so the two sides can never drift apart.
 * `floating`: lies over the screens (member tabs); otherwise it sits in the flow, under its screen.
 */
export function TabPill({
  items,
  floating = false,
  testID,
}: {
  items: TabPillItem[];
  floating?: boolean;
  testID?: string;
}) {
  const { colors, elevation } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      pointerEvents={floating ? 'box-none' : 'auto'}
      style={[floating ? styles.floating : styles.dock, { paddingBottom: Math.max(insets.bottom, TAB_DOCK_MIN_INSET) }]}
    >
      <View
        style={[styles.bar, elevation.md, { backgroundColor: colors.surface, borderColor: colors.border }]}
        accessibilityRole="tablist"
        testID={testID}
      >
        {items.map((item) => {
          const ink = item.focused ? colors.accent : colors.inkMuted;
          const count = item.count ?? 0;
          return (
            <Pressable
              key={item.key}
              style={styles.tab}
              onPress={item.onPress}
              accessibilityRole="tab"
              accessibilityState={{ selected: item.focused }}
              accessibilityLabel={item.accessibilityLabel ?? (count ? `${item.label}, ${count}` : item.label)}
              testID={item.testID}
            >
              {/* Remount on focus change and always set a background: on Android (Fabric) a face that
                  gains its backgroundColor after mount paints without its border radius. */}
              <EdgeSurface
                key={item.focused ? 'on' : 'off'}
                edge={item.focused ? colors.accentTintEdge : 'transparent'}
                travel={3}
                radius={radius.pill}
                containerStyle={styles.cellBox}
                style={[styles.cell, { backgroundColor: item.focused ? colors.accentTint : 'transparent' }]}
              >
                <View>
                  <Ionicons name={item.focused ? item.iconOn : item.icon} size={22} color={ink} />
                  {count > 0 ? (
                    <View style={[styles.badge, { backgroundColor: colors.accent }]}>
                      <Text style={[styles.badgeText, { color: colors.onAccent }]} maxFontSizeMultiplier={1.2}>
                        {count > 9 ? '9+' : count}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.label, { color: ink }]} numberOfLines={1}>
                  {item.label}
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
  dock: { paddingHorizontal: space.md },
  // Absolute, so the screens run the full height and scroll visibly behind and around the pill;
  // box-none lets touches in the clear space around it reach the screen.
  floating: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.md },
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

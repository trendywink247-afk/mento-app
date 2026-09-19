import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EdgeSurface } from '@/components/EdgeSurface';
import { tabSceneInterpolator, tabTransitionSpec } from '@/components/motion/tabTransition';
import { useI18n, type TKey } from '@/lib/i18n';
import { registerForPushNotifications } from '@/lib/pushNotifications';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space } from '@/theme/tokens';

/**
 * Tab set (founder ruling 2026-07-13, spec 2026-07-13-path-communities.md):
 * Chats / Path / Journals / Profile. Path absorbs Mentors — listeners now live
 * inside the user's path; the mentors screen stays routable (hidden from the bar)
 * for Browse + deep links. Chat detail (app/chat/[id]) is pushed on the root stack.
 */
const TABS: {
  name: string;
  label: TKey;
  active: keyof typeof Ionicons.glyphMap;
  idle: keyof typeof Ionicons.glyphMap;
}[] = [
  { name: 'chats', label: 'tabs.chats', active: 'chatbubble-ellipses', idle: 'chatbubble-ellipses-outline' },
  { name: 'path', label: 'tabs.path', active: 'compass', idle: 'compass-outline' },
  { name: 'journals', label: 'tabs.journals', active: 'book', idle: 'book-outline' },
  { name: 'profile', label: 'tabs.profile', active: 'person', idle: 'person-outline' },
];

/** Board bar (A06–A09): a white pill floating over the oat ground, 16 in from the sides.
 * Each tab is a 48px cell — icon over label; the active cell is an accent-tint pillow
 * (3px edge) with both in the accent. The bar keeps its own place in the layout (screens
 * end at its top edge — that edge is the companion's floor on My Chats). */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const { colors, elevation } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.dock, { backgroundColor: colors.bg, paddingBottom: Math.max(insets.bottom, 20) }]}>
      <View style={[styles.bar, elevation.md, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {TABS.map((tab) => {
          // Name-based lookup: hidden routes (mentors) share this navigator, so the
          // bar's order no longer mirrors the route array's indexes.
          const routeIndex = state.routes.findIndex((r) => r.name === tab.name);
          const focused = state.index === routeIndex;
          const route = state.routes[routeIndex];
          if (!route) return null;
          const ink = focused ? colors.accent : colors.inkMuted;
          return (
            <Pressable
              key={tab.name}
              style={styles.tab}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={t(tab.label)}
              testID={`tab-${tab.name}`}
            >
              <EdgeSurface
                edge={focused ? colors.accentTintEdge : 'transparent'}
                travel={3}
                radius={radius.pill}
                containerStyle={styles.cellBox}
                style={[styles.cell, focused && { backgroundColor: colors.accentTint }]}
              >
                <Ionicons name={tab.idle} size={22} color={ink} />
                <Text style={[styles.label, { color: ink }]} numberOfLines={1}>
                  {t(tab.label)}
                </Text>
              </EdgeSurface>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function TabsLayout() {
  useSessionGuard();
  const { t } = useI18n();

  // Once per app-open, now that a session is confirmed live — fire-and-forget,
  // never blocks the tab bar from rendering.
  useEffect(() => {
    void registerForPushNotifications();
  }, []);

  // Tabs move sideways in bar order instead of cutting (components/motion/tabTransition.ts).
  // Reduced motion: no transition at all — the switch is an instant, still swap.
  const reduced = useReducedMotion();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        ...(reduced
          ? { animation: 'none' as const }
          : {
              animation: 'shift' as const,
              transitionSpec: tabTransitionSpec,
              sceneStyleInterpolator: tabSceneInterpolator,
            }),
      }}
      tabBar={(props) => <TabBar {...props} />}
    >
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: t(tab.label) }} />
      ))}
      {/* Routable but off the bar — reached via Path → Browse and existing deep links. */}
      <Tabs.Screen name="mentors" options={{ title: 'Mentors', href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  dock: { paddingHorizontal: space.md },
  bar: {
    height: 68,
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
});

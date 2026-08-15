import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useI18n, type TKey } from '@/lib/i18n';
import { registerForPushNotifications } from '@/lib/pushNotifications';
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
  { name: 'path', label: 'tabs.path', active: 'trail-sign', idle: 'trail-sign-outline' },
  { name: 'journals', label: 'tabs.journals', active: 'book', idle: 'book-outline' },
  { name: 'profile', label: 'tabs.profile', active: 'person', idle: 'person-outline' },
];

/** Mockup bar: white surface, rounded top, soft shadow; the active tab's icon sits
 * in a lavender-tint pill with the label tinted accent below it. */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const { colors, elevation } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        elevation.lg,
        { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, space.sm) },
      ]}
    >
      {TABS.map((tab) => {
        // Name-based lookup: hidden routes (mentors) share this navigator, so the
        // bar's order no longer mirrors the route array's indexes.
        const routeIndex = state.routes.findIndex((r) => r.name === tab.name);
        const focused = state.index === routeIndex;
        const route = state.routes[routeIndex];
        if (!route) return null;
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
            <View style={[styles.pill, focused && { backgroundColor: colors.accentTint }]}>
              <Ionicons
                name={focused ? tab.active : tab.idle}
                size={22}
                color={focused ? colors.accent : colors.inkMuted}
              />
            </View>
            <Text
              style={[
                styles.label,
                { color: focused ? colors.accent : colors.inkMuted },
                focused && { fontFamily: font.sansBold },
              ]}
            >
              {t(tab.label)}
            </Text>
          </Pressable>
        );
      })}
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

  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: t(tab.label) }} />
      ))}
      {/* Routable but off the bar — reached via Path → Browse and existing deep links. */}
      <Tabs.Screen name="mentors" options={{ title: 'Mentors', href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingTop: space.sm,
    paddingHorizontal: space.sm,
  },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  pill: {
    width: 56,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 12, fontFamily: font.sansSemi, lineHeight: 16 },
});

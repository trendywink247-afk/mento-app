import { Ionicons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space } from '@/theme/tokens';

/**
 * v1 tab set per DECISIONS: Chats / Journals / Mentors / Profile (the chat-flow
 * mockups' bar; Home/Mirror/Community variants are deferred modules). Chat detail
 * (app/chat/[id]) is pushed on the root stack, above this bar.
 */
const TABS: {
  name: string;
  label: string;
  active: keyof typeof Ionicons.glyphMap;
  idle: keyof typeof Ionicons.glyphMap;
}[] = [
  { name: 'chats', label: 'Chats', active: 'chatbubble-ellipses', idle: 'chatbubble-ellipses-outline' },
  { name: 'journals', label: 'Journals', active: 'book', idle: 'book-outline' },
  { name: 'mentors', label: 'Mentors', active: 'people', idle: 'people-outline' },
  { name: 'profile', label: 'Profile', active: 'person', idle: 'person-outline' },
];

/** Mockup bar: white surface, rounded top, soft shadow; the active tab's icon sits
 * in a lavender-tint pill with the label tinted accent below it. */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const { colors, elevation } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.bar,
        elevation.lg,
        { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, space.sm) },
      ]}
    >
      {TABS.map((tab, index) => {
        const focused = state.index === index;
        const route = state.routes[index];
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
            accessibilityLabel={tab.label}
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
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  useSessionGuard();

  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <TabBar {...props} />}>
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
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

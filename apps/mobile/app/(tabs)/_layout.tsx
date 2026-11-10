import Ionicons from '@expo/vector-icons/Ionicons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { TabPill } from '@/components/TabPill';
import { tabSceneInterpolator, tabTransitionSpec } from '@/components/motion/tabTransition';
import { api } from '@/lib/api';
import { useI18n, type TKey } from '@/lib/i18n';
import { registerForPushNotifications } from '@/lib/pushNotifications';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { useSessionGuard } from '@/lib/useSessionGuard';

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

/** The member's bottom bar: the shared pill (components/TabPill.tsx), floating over the screens.
 * The bar keeps its own place in the layout (screens end at its top edge — that edge is the
 * companion's floor on My Chats). */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const { t } = useI18n();
  return (
    <TabPill
      floating
      items={TABS.flatMap((tab) => {
        // Name-based lookup: hidden routes (mentors) share this navigator, so the bar's order no
        // longer mirrors the route array's indexes.
        const routeIndex = state.routes.findIndex((r) => r.name === tab.name);
        const route = state.routes[routeIndex];
        if (!route) return [];
        const focused = state.index === routeIndex;
        return [
          {
            key: tab.name,
            label: t(tab.label),
            icon: tab.idle,
            iconOn: tab.active,
            focused,
            onPress: () => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
            },
            accessibilityLabel: t(tab.label),
            testID: `tab-${tab.name}`,
          },
        ];
      })}
    />
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

  // The terms gate (WS3 T3.9): a member who joined before the app asked is asked once,
  // explicitly, before a chat can start — only while the server enforces it
  // (`terms_required`). Best-effort: a failed read asks nothing; the server still refuses.
  const router = useRouter();
  useEffect(() => {
    let live = true;
    api
      .me()
      .then((me) => {
        if (live && me.terms_required) router.push('/terms?ask=1');
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [router]);

  // Tabs move sideways in bar order instead of cutting (components/motion/tabTransition.ts).
  // Reduced motion: no transition at all — the switch is an instant, still swap.
  const reduced = useReducedMotion();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Every tab lies on the one sky (components/motion/SkyGround.tsx).
        sceneStyle: { backgroundColor: 'transparent' },
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
    </Tabs>
  );
}

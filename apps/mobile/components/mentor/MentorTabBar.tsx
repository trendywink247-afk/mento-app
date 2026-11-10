import Ionicons from '@expo/vector-icons/Ionicons';

import { TabPill } from '@/components/TabPill';
import { useI18n } from '@/lib/i18n';

export type MentorTab = 'requests' | 'chats' | 'home' | 'profile';

const TABS: { key: MentorTab; icon: keyof typeof Ionicons.glyphMap; iconOn: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'requests', icon: 'mail-outline', iconOn: 'mail' },
  { key: 'chats', icon: 'chatbubble-ellipses-outline', iconOn: 'chatbubble-ellipses' },
  { key: 'home', icon: 'home-outline', iconOn: 'home' },
  { key: 'profile', icon: 'person-outline', iconOn: 'person' },
];

/**
 * The mentor side's bottom bar: Requests with a count, Chats, Home, Profile. Plain state, not routes:
 * the one `/mentor-home` route (and every push tap and old link to it) stays as it is. The count is a
 * number of waiting requests, never a name or any text. The look is the member bar's: components/TabPill.tsx.
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
  const { t } = useI18n();
  const label = (k: MentorTab) =>
    k === 'requests'
      ? t('mentor.requestsTitle')
      : k === 'chats'
        ? t('mentor.tabChats')
        : k === 'home'
          ? t('mentor.tabHome')
          : t('mentor.tabProfile');
  return (
    <TabPill
      testID="mentor-tabbar"
      items={TABS.map(({ key, icon, iconOn }) => ({
        key,
        label: label(key),
        icon,
        iconOn,
        focused: tab === key,
        onPress: () => onChange(key),
        count: key === 'requests' ? requestCount : 0,
        testID: `mentor-tab-${key}`,
      }))}
    />
  );
}

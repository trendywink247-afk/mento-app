import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, type Wash } from '@/theme/tokens';

export type SheetChoice = 'lock' | 'status' | 'pause' | 'end' | 'report' | 'coffee';

const ITEMS: {
  key: SheetChoice;
  icon: keyof typeof Ionicons.glyphMap;
  tone: Wash;
  title: (s: { locked: boolean }) => string;
  body: string;
  testID: string;
}[] = [
  {
    key: 'lock',
    icon: 'lock-closed-outline',
    tone: 'accent',
    title: (s) => (s.locked ? '1. Unlock this Conversation' : '1. Lock this Conversation'),
    body: 'Protect this chat with a 4-digit PIN.',
    testID: 'opt-lock',
  },
  {
    key: 'status',
    icon: 'moon-outline',
    tone: 'indigo',
    title: () => '2. Chat Status',
    body: 'Turn off or change your status for this conversation only.',
    testID: 'opt-status',
  },
  {
    key: 'pause',
    icon: 'notifications-off-outline',
    tone: 'orange',
    title: () => '3. Pause Notifications from this Mentor',
    body: "You won't receive new messages from this conversation.",
    testID: 'opt-pause',
  },
  {
    key: 'end',
    icon: 'leaf-outline',
    tone: 'green',
    title: () => '4. End Conversation',
    body: 'Close this conversation whenever you feel ready.',
    testID: 'opt-end',
  },
  {
    key: 'report',
    icon: 'alert-circle-outline',
    tone: 'danger',
    title: () => '5. Report or Block',
    body: 'Report inappropriate behavior or block this mentor.',
    testID: 'opt-report',
  },
  {
    key: 'coffee',
    icon: 'cafe-outline',
    tone: 'accent',
    title: () => '6. Buy the Mento Team a Coffee',
    body: 'Support the Mento team and help us keep this space safe and free.',
    testID: 'opt-coffee',
  },
];

/** The Conversation Options bottom sheet (mockup: drag handle, X, six numbered
 * bordered cards with tinted icon circles, well-being footer card). */
export function OptionsSheet({
  locked,
  onChoose,
  onClose,
}: {
  locked: boolean;
  onChoose: (c: SheetChoice) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.sheet, { backgroundColor: colors.surface }]}
      testID="options-sheet"
      accessibilityViewIsModal
    >
      <View style={[styles.handle, { backgroundColor: colors.border }]} />
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
            Conversation Options
          </Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>
            Manage your experience in this conversation.
          </Text>
        </View>
        <Pressable
          onPress={onClose}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close options"
          testID="options-close"
          style={[styles.closeBtn, { backgroundColor: colors.surfaceAlt }]}
        >
          <Ionicons name="close" size={18} color={colors.inkMuted} />
        </Pressable>
      </View>

      {ITEMS.map((item) => (
        <Pressable
          key={item.key}
          onPress={() => onChoose(item.key)}
          accessibilityRole="button"
          accessibilityLabel={item.title({ locked })}
          testID={item.testID}
          style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}
        >
          <IconBadge icon={item.icon} tone={item.tone} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{item.title({ locked })}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{item.body}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
        </Pressable>
      ))}

      <View style={[styles.footerCard, { backgroundColor: colors.surfaceAlt }]}>
        <IconBadge icon="heart-outline" size={36} />
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: colors.ink }]}>
            Your well-being and safety are our priority.
          </Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>
            You're not alone. We're here for you.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingBottom: space.lg,
    gap: space.sm,
  },
  handle: { alignSelf: 'center', width: 56, height: 5, borderRadius: 3, marginTop: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, marginVertical: space.xs },
  title: { fontFamily: font.sansHeavy, fontSize: 24, lineHeight: 32 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md + 2,
    padding: space.sm + 2,
  },
  cardTitle: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 21 },
  footerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.xs,
  },
});

import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { Screen } from '@/components/Screen';
import { SceneTile } from '@/components/art/SceneTile';
import { api } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, type Wash } from '@/theme/tokens';

const JOURNALS: {
  channel: string;
  route: string;
  title: string;
  body: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: Wash;
}[] = [
  {
    channel: 'finance',
    route: 'finance',
    title: 'Finance Journal',
    body: 'Track your income, expenses and financial decisions.',
    icon: 'wallet-outline',
    tone: 'green',
  },
  {
    channel: 'mood',
    route: 'mood',
    title: 'Mood Journal',
    body: 'Understand your emotions and patterns.',
    icon: 'heart-outline',
    tone: 'danger',
  },
  {
    channel: 'mentor_notes',
    route: 'mentor-notes',
    title: 'Mentor Notes',
    body: 'Save wisdom and advice from your mentor.',
    icon: 'book-outline',
    tone: 'accent',
  },
  {
    channel: 'gratitude',
    route: 'gratitude',
    title: 'Gratitude Journal',
    body: 'A daily reminder of the good things in life.',
    icon: 'leaf-outline',
    tone: 'orange',
  },
];

/** Journals hub (the `10.31.08 AM.jpeg` mockup): AI-assistant card + journal list
 * with count badges. The AI assistant ships after the LLM decision — the card is
 * present but honestly marked Coming soon. */
export default function JournalsTab() {
  const router = useRouter();
  const { colors, elevation } = useTheme();
  const [counts, setCounts] = useState<Record<string, number>>({});

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void api
        .journalSummary()
        .then((s) => {
          if (active) setCounts(s);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }, []),
  );

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space.lg }}>
        <Text style={[type.displaySerif, { color: colors.ink }]} accessibilityRole="header">
          Journals
        </Text>
        <Text style={[type.body, { color: colors.inkMuted, marginBottom: space.md }]}>
          A space for your thoughts, reflections and everything in between.
        </Text>

        <View style={[styles.aiCard, { backgroundColor: colors.surfaceAlt }]}>
          <View style={styles.aiHead}>
            <IconBadge icon="sparkles" size={40} />
            <View style={{ flex: 1 }}>
              <View style={styles.aiTitleRow}>
                <Text style={[styles.aiTitle, { color: colors.ink }]}>AI Journal Assistant</Text>
                <View style={[styles.newBadge, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.newBadgeText, { color: colors.accent }]}>Coming soon</Text>
                </View>
              </View>
              <Text style={[type.caption, { color: colors.inkMuted }]}>
                Chat with AI about anything. It will help you log it in the right journal.
              </Text>
            </View>
          </View>
          <View style={styles.aiArt}>
            <SceneTile name="journalsAi" size={84} />
          </View>
        </View>

        <View style={styles.sectionRow}>
          <Text style={[styles.section, { color: colors.ink }]}>My Journals</Text>
        </View>

        {JOURNALS.map((j) => (
          <Pressable
            key={j.channel}
            onPress={() => router.push({ pathname: '/journal/[channel]', params: { channel: j.route } })}
            accessibilityRole="button"
            accessibilityLabel={j.title}
            testID={`journal-${j.route}`}
            style={[styles.row, { backgroundColor: colors.surface }, elevation.sm]}
          >
            <IconBadge icon={j.icon} tone={j.tone} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.ink }]}>{j.title}</Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>{j.body}</Text>
            </View>
            {counts[j.channel] ? (
              <View style={[styles.count, { backgroundColor: colors.surfaceAlt }]}>
                <Text style={[styles.countText, { color: colors.accent }]}>{counts[j.channel]}</Text>
              </View>
            ) : null}
            <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
          </Pressable>
        ))}

        <View style={[styles.privacy, { backgroundColor: colors.surfaceAlt }]}>
          <Ionicons name="lock-closed-outline" size={15} color={colors.accentSoft} />
          <Text style={[type.caption, { color: colors.inkMuted, flex: 1 }]}>
            Journals are yours alone — readable offline soon, never shared.
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  aiCard: { borderRadius: radius.lg, padding: space.md, gap: space.sm },
  aiHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  aiTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
  aiTitle: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 24 },
  newBadge: { borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: space.sm },
  newBadgeText: { fontFamily: font.sansBold, fontSize: 11, lineHeight: 16 },
  aiArt: { alignItems: 'flex-end' },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.md,
    marginBottom: space.sm,
  },
  section: { fontFamily: font.sansBold, fontSize: 18, lineHeight: 25 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.sm + 2,
    marginBottom: space.sm,
  },
  rowTitle: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 23 },
  count: {
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
  },
  countText: { fontFamily: font.sansBold, fontSize: 13 },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.xs,
  },
});

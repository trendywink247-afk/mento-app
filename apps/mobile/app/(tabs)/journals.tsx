import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { Screen } from '@/components/Screen';
import { LottieTile } from '@/components/art/LottieTile';
import { SceneTile } from '@/components/art/SceneTile';
import { api } from '@/lib/api';
import { useI18n, type TKey } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, type Wash } from '@/theme/tokens';

const JOURNALS: {
  channel: string;
  route: string;
  title: TKey;
  body: TKey;
  icon: keyof typeof Ionicons.glyphMap;
  tone: Wash;
}[] = [
  {
    channel: 'finance',
    route: 'finance',
    title: 'journals.financeTitle',
    body: 'journals.financeBody',
    icon: 'wallet-outline',
    tone: 'green',
  },
  {
    channel: 'mood',
    route: 'mood',
    title: 'journals.moodTitle',
    body: 'journals.moodBody',
    icon: 'heart-outline',
    tone: 'danger',
  },
  {
    channel: 'mentor_notes',
    route: 'mentor-notes',
    title: 'journals.mentorNotesTitle',
    body: 'journals.mentorNotesBody',
    icon: 'book-outline',
    tone: 'accent',
  },
  {
    channel: 'gratitude',
    route: 'gratitude',
    title: 'journals.gratitudeTitle',
    body: 'journals.gratitudeBody',
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
  const { t } = useI18n();
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
          {t('journals.title')}
        </Text>
        <Text style={[type.body, { color: colors.inkMuted, marginBottom: space.md }]}>
          {t('journals.sub')}
        </Text>

        <Pressable
          onPress={() => router.push('/journal/organize')}
          accessibilityRole="button"
          accessibilityLabel={t('journals.aiCta')}
          testID="journal-ai-organize"
          style={[styles.aiCard, { backgroundColor: colors.surfaceAlt }]}
        >
          <View style={styles.aiHead}>
            <IconBadge icon="sparkles" size={40} />
            <View style={{ flex: 1 }}>
              <View style={styles.aiTitleRow}>
                <Text style={[styles.aiTitle, { color: colors.ink }]}>{t('journals.aiTitle')}</Text>
                <View style={[styles.newBadge, { backgroundColor: colors.surface }]}>
                  <Text style={[styles.newBadgeText, { color: colors.accent }]}>{t('journals.beta')}</Text>
                </View>
              </View>
              <Text style={[type.caption, { color: colors.inkMuted }]}>
                {t('journals.aiBody')}
              </Text>
              <View style={styles.aiCtaRow}>
                <Text style={[styles.aiCta, { color: colors.accent }]}>{t('journals.aiCta')}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.accent} />
              </View>
            </View>
          </View>
          <View style={styles.aiArt}>
            <LottieTile name="notebook" fallback="journalsAi" size={84} />
          </View>
        </Pressable>

        <View style={styles.sectionRow}>
          <Text style={[styles.section, { color: colors.ink }]}>{t('journals.my')}</Text>
        </View>

        {JOURNALS.map((j) => (
          <Pressable
            key={j.channel}
            onPress={() => router.push({ pathname: '/journal/[channel]', params: { channel: j.route } })}
            accessibilityRole="button"
            accessibilityLabel={t(j.title)}
            testID={`journal-${j.route}`}
            style={[styles.row, { backgroundColor: colors.surface }, elevation.sm]}
          >
            <IconBadge icon={j.icon} tone={j.tone} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.rowTitle, { color: colors.ink }]}>{t(j.title)}</Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>{t(j.body)}</Text>
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
            {t('journals.privacy')}
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
  aiCtaRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: space.xs },
  aiCta: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
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

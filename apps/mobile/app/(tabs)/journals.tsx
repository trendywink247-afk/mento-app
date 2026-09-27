import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { IconBadge } from '@/components/IconBadge';
import { Screen } from '@/components/Screen';
import { CompanionPerches, CompanionSlot, useCompanionPlacement } from '@/components/art/PerchedCompanion';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { api, type JournalEntry } from '@/lib/api';
import type { PlacementSlot } from '@/lib/companionPlacement';
import { haptic } from '@/lib/haptics';
import { useI18n, type TKey } from '@/lib/i18n';
import { dayId, moodLabelKey } from '@/lib/journalDays';
import { screenCache } from '@/lib/screenCache';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/** Canonical mood values (same set as journal/[channel].tsx — stored in entry meta). */
const MOODS = ['Calm', 'Happy', 'Okay', 'Low', 'Anxious'] as const;
type Mood = (typeof MOODS)[number];
const MOOD_LABELS: Record<Mood, TKey> = {
  Calm: 'journals.moodCalm',
  Happy: 'journals.moodHappy',
  Okay: 'journals.moodOkay',
  Low: 'journals.moodLow',
  Anxious: 'journals.moodAnxious',
};
const MOOD_ICONS: Record<Mood, keyof typeof Ionicons.glyphMap> = {
  Calm: 'leaf-outline',
  Happy: 'sunny-outline',
  Okay: 'remove-circle-outline',
  Low: 'cloud-outline',
  Anxious: 'pulse-outline',
};

/** The channels that make up the one journal. Finance is off-path for now (DECISIONS
 * §L.8 / the 2026-09-06 call) — it is never merged in, only linked if it has history. */
const MERGED = ['mentor_notes', 'gratitude', 'mood'] as const;

/** Where the companion can be on this screen (lib/companionPlacement.ts). The Today card's
 * top-right edge is where it always used to sit — now the home slot, one place among several.
 * Every slot has clear ground above it: the 60px between the subtitle and the Today card, and
 * the right-hand side of the "Write" heading row. */
const PERCHES: PlacementSlot[] = [
  { id: 'todayTopRight', type: 'top', level: 'mid', home: true },
  { id: 'todayTopLeft', type: 'lean', level: 'mid' },
  { id: 'writeTop', type: 'top', level: 'low' },
  { id: 'todayNap', type: 'nap', level: 'mid' },
  { id: 'todayDangle', type: 'dangle', level: 'mid' },
  { id: 'todayPeek', type: 'peek', level: 'mid' },
  { id: 'todayHang', type: 'hang', level: 'mid' },
];
const SHELF_DAYS = 6;
const KEPT_PREVIEW = 3;

const dayKey = dayId;

/** Unified journal — "today first, then the shelf" (DECISIONS §L.8). One place: what
 * the member kept from a chat sits beside what they wrote themselves. Front-end only:
 * it merges the existing channels client-side; the per-channel screens stay as the
 * writing surfaces. No counts of days, no streaks — a quiet day is simply absent. */
export default function JournalsTab() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  // Last-loaded shelf first, quiet refresh on focus (lib/screenCache.ts).
  const cachedJournal = screenCache.get('journal');
  const [entries, setEntries] = useState<JournalEntry[] | null>(cachedJournal?.entries ?? null);
  const [hasFinance, setHasFinance] = useState(cachedJournal?.hasFinance ?? false);
  const [failed, setFailed] = useState(false);
  const [savingMood, setSavingMood] = useState(false);

  const load = useCallback(async () => {
    try {
      const [lists, summary] = await Promise.all([
        Promise.all(MERGED.map((c) => api.listJournalEntries(c))),
        api.journalSummary(),
      ]);
      const all = lists.flat().sort((a, b) => b.created_at.localeCompare(a.created_at));
      setEntries(all);
      setHasFinance((summary.finance ?? 0) > 0);
      screenCache.set('journal', { entries: all, hasFinance: (summary.finance ?? 0) > 0 });
      setFailed(false);
    } catch {
      // Still, not alarming: the hub keeps whatever it last showed.
      setFailed(true);
      setEntries((prev) => prev ?? []);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const { today, shelf, kept, moodToday } = useMemo(() => {
    const all = entries ?? [];
    const todayKey = dayKey(new Date().toISOString());
    const todays = all.filter((e) => dayKey(e.created_at) === todayKey);
    const byDay = new Map<string, JournalEntry[]>();
    for (const e of all) {
      const k = dayKey(e.created_at);
      if (k === todayKey) continue;
      byDay.set(k, [...(byDay.get(k) ?? []), e]);
    }
    const mood = todays.find((e) => e.channel === 'mood' && e.meta.mood)?.meta.mood ?? null;
    return {
      today: todays,
      shelf: [...byDay.values()].slice(0, SHELF_DAYS),
      kept: all.filter((e) => e.channel === 'mentor_notes'),
      moodToday: mood,
    };
  }, [entries]);

  const dayLabel = (iso: string): string => {
    const d = new Date(iso);
    const y = new Date();
    y.setDate(y.getDate() - 1);
    if (dayKey(iso) === dayKey(y.toISOString())) return t('chat.yesterday');
    return d.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'short', day: 'numeric' });
  };

  const logMood = async (m: Mood) => {
    if (savingMood) return;
    setSavingMood(true);
    try {
      // Same contract as journal/[channel].tsx: a mood with no note stores the mood as its body.
      await api.createJournalEntry({ channel: 'mood', body: m, meta: { mood: m } });
      haptic.success();
      await load();
    } catch {
      // A failed save stays still — the row simply remains untouched.
    } finally {
      setSavingMood(false);
    }
  };

  // A failed load is a still state: the companion keeps its home place (T&S #11).
  const perch = useCompanionPlacement('journal', PERCHES, { still: failed });

  const keptToday = today.filter((e) => e.channel === 'mentor_notes');
  // A bare mood check-in (body === its own mood value) is shown on the mood row, not as writing.
  const wroteToday = today.filter(
    (e) => e.channel !== 'mentor_notes' && e.body.trim().length > 0 && e.body !== e.meta.mood,
  );

  return (
    <Screen>
      <CompanionPerches placement={perch}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space.xl }}>
        <Text style={[type.displaySerif, { color: colors.ink }]} accessibilityRole="header">
          {t('journals.hubTitle')}
        </Text>
        <Text style={[type.body, { color: colors.inkMuted, marginBottom: space.lg }]}>{t('journals.hubSub')}</Text>

        {/* Today — one card that reads as a story: kept guidance, then the member's own words. */}
        <Entrance index={0}>
          <View style={styles.todayWrap}>
            {/* The Today card is the furniture: its slots are its own absolute children. */}
            <View style={styles.furniture}>
            <CompanionSlot id="todayTopRight" size={64} inset={space.md} nudge={8} />
            <CompanionSlot id="todayTopLeft" size={56} align="left" inset={space.md} />
            <CompanionSlot id="todayNap" size={56} inset={96} />
            <CompanionSlot id="todayDangle" size={68} inset={space.lg} />
            <CompanionSlot id="todayPeek" size={46} align="center" />
            <CompanionSlot id="todayHang" size={54} inset={space.lg} />
            <EdgeSurface edge={colors.edgeSurface} radius={radius.lg} style={[styles.card, { backgroundColor: colors.surface }]} testID="journal-today">
              <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('journals.today')}</Text>

              {keptToday.length > 0 ? (
                <View style={styles.block}>
                  <Text style={[styles.eyebrow, { color: colors.inkMuted }]}>{t('journals.kept')}</Text>
                  {keptToday.map((e) => (
                    <PressKey
                      key={e.id}
                      onPress={() => {
                        // The chat route needs its channel + the mentor's name, not just the id.
                        const c = screenCache.get('chats')?.rows.find((r) => r.id === String(e.meta.conversation_id ?? ''));
                        if (c && !c.is_locked && c.status !== 'wiped') {
                          router.push({
                            pathname: '/chat/[id]',
                            params: { id: c.id, listener: c.listener_persona_name, channel: c.stream_channel_id ?? '' },
                          });
                        } else router.push({ pathname: '/journal/[channel]', params: { channel: 'mentor-notes' } });
                      }}
                      edge={colors.accentEdge}
                      travel={3}
                      intent="navigate"
                      radius={radius.md}
                      accessibilityLabel={t('journals.keptFrom', { name: e.meta.listener_persona ?? t('chat.yourListener') })}
                      style={[styles.kept, { backgroundColor: colors.accentTint }]}
                    >
                      <Text style={[type.body, { color: colors.ink }]}>{e.body}</Text>
                      <Text style={[type.caption, { color: colors.accent, fontFamily: font.sansBold }]}>
                        {t('journals.keptFrom', { name: e.meta.listener_persona ?? t('chat.yourListener') })}
                      </Text>
                    </PressKey>
                  ))}
                </View>
              ) : null}

              {wroteToday.length > 0 ? (
                <View style={styles.block}>
                  <Text style={[styles.eyebrow, { color: colors.inkMuted }]}>{t('journals.youWrote')}</Text>
                  {wroteToday.map((e) => (
                    <Text key={e.id} style={[type.body, { color: colors.ink }]}>
                      {e.body}
                    </Text>
                  ))}
                </View>
              ) : null}

              {entries !== null && keptToday.length === 0 && wroteToday.length === 0 ? (
                <Text style={[type.body, { color: colors.inkMuted }]}>{t('journals.todayEmpty')}</Text>
              ) : null}

              <View style={[styles.moodBlock, { borderTopColor: colors.border }]}>
                <Text style={[styles.eyebrow, { color: colors.inkMuted }]}>
                  {moodToday
                    ? t('journals.moodLogged', {
                        // The Write page (board A28) logs the five-step scale; both vocabularies read here.
                        mood: moodLabelKey(String(moodToday)) ? t(moodLabelKey(String(moodToday)) as TKey) : String(moodToday),
                      })
                    : t('journals.moodToday')}
                </Text>
                <View style={styles.moodRow}>
                  {MOODS.map((m) => {
                    const on = moodToday === m;
                    return (
                      <PressKey
                        key={m}
                        onPress={() => void logMood(m)}
                        edge={on ? colors.accentEdge : colors.edgeAlt}
                        travel={3}
                        intent="select"
                        radius={radius.md}
                        disabled={savingMood}
                        accessibilityLabel={t(MOOD_LABELS[m])}
                        accessibilityState={{ selected: on }}
                        testID={`journal-mood-${m.toLowerCase()}`}
                        containerStyle={styles.moodCell}
                        style={[styles.moodKey, { backgroundColor: on ? colors.accentTint : colors.surfaceAlt }]}
                      >
                        <Ionicons name={MOOD_ICONS[m]} size={20} color={on ? colors.accent : colors.inkMuted} />
                        <Text numberOfLines={1} style={[styles.moodLabel, { color: on ? colors.accent : colors.inkMuted }]}>
                          {t(MOOD_LABELS[m])}
                        </Text>
                      </PressKey>
                    );
                  })}
                </View>
              </View>
            </EdgeSurface>
            </View>
          </View>
        </Entrance>

        {failed ? (
          <Text style={[type.caption, { color: colors.inkMuted, marginTop: space.sm }]}>{t('journals.loadError')}</Text>
        ) : null}

        {/* Write — the per-channel screens remain the writing surfaces. */}
        <Entrance index={1}>
          <Text style={[styles.section, { color: colors.ink }]}>{t('journals.writeTitle')}</Text>
          <View style={styles.writeRow}>
            <CompanionSlot id="writeTop" size={52} inset={space.md} />
            <PressKey
              onPress={() => router.push({ pathname: '/journal/[channel]', params: { channel: 'gratitude' } })}
              edge={colors.edgeSurface}
              accessibilityLabel={t('journals.writeGratitude')}
              testID="journal-gratitude"
              containerStyle={styles.writeCell}
              style={[styles.writeKey, { backgroundColor: colors.surface }]}
            >
              <IconBadge icon="leaf-outline" tone="orange" size={40} />
              <Text style={[styles.writeLabel, { color: colors.ink }]}>{t('journals.writeGratitude')}</Text>
            </PressKey>
            <PressKey
              onPress={() => router.push({ pathname: '/journal/[channel]', params: { channel: 'mood' } })}
              edge={colors.edgeSurface}
              accessibilityLabel={t('journals.writeMood')}
              testID="journal-mood"
              containerStyle={styles.writeCell}
              style={[styles.writeKey, { backgroundColor: colors.surface }]}
            >
              <IconBadge icon="heart-outline" tone="danger" size={40} />
              <Text style={[styles.writeLabel, { color: colors.ink }]}>{t('journals.writeMood')}</Text>
            </PressKey>
          </View>
          {/* Today's page (board A28) — the lined writing surface. */}
          <PressKey
            onPress={() => router.push('/journal/write')}
            edge={colors.accentEdge}
            radius={radius.md}
            accessibilityLabel={t('journalPage.writeToday')}
            testID="journal-write"
            containerStyle={styles.writeTodayBox}
            style={[styles.writeToday, { backgroundColor: colors.accent }]}
          >
            <Ionicons name="create-outline" size={20} color={colors.onAccent} />
            <Text style={[type.keyDense, { color: colors.onAccent }]}>{t('journalPage.writeToday')}</Text>
          </PressKey>
        </Entrance>

        {/* Past days — a shelf to glance along. A day with nothing written is simply not there. */}
        {shelf.length > 0 ? (
          <Entrance index={2}>
            <Text style={[styles.section, { color: colors.ink }]}>{t('journals.pastDays')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.shelf}>
              {shelf.map((day) => (
                <PressKey
                  key={day[0].id}
                  onPress={() => router.push({ pathname: '/journal/day/[date]', params: { date: dayId(day[0].created_at) } })}
                  edge={colors.edgeAlt}
                  radius={radius.lg}
                  accessibilityLabel={t('journalPage.openDayA11y', { day: dayLabel(day[0].created_at) })}
                  testID={`journal-day-${dayId(day[0].created_at)}`}
                  containerStyle={styles.dayCell}
                  style={[styles.dayCard, { backgroundColor: colors.surfaceAlt }]}
                >
                  <Text style={[styles.eyebrow, { color: colors.inkMuted }]}>{dayLabel(day[0].created_at)}</Text>
                  {day.slice(0, 2).map((e) => (
                    <View key={e.id} style={styles.dayLine}>
                      <Ionicons
                        name={e.channel === 'mentor_notes' ? 'bookmark' : e.channel === 'mood' ? 'heart-outline' : 'leaf-outline'}
                        size={14}
                        color={e.channel === 'mentor_notes' ? colors.accent : colors.inkMuted}
                      />
                      <Text numberOfLines={2} style={[type.caption, { color: colors.ink, flex: 1 }]}>
                        {e.meta.mood && e.body === e.meta.mood && moodLabelKey(e.meta.mood)
                          ? t(moodLabelKey(e.meta.mood) as TKey)
                          : e.body}
                      </Text>
                    </View>
                  ))}
                </PressKey>
              ))}
            </ScrollView>
          </Entrance>
        ) : null}

        {/* Kept guidance — everything saved from chats, across mentors. */}
        <Entrance index={3}>
          <View style={styles.sectionRow}>
            <Text style={[styles.section, styles.sectionInline, { color: colors.ink }]}>{t('journals.keptAll')}</Text>
            <PressKey
              onPress={() => router.push({ pathname: '/journal/[channel]', params: { channel: 'mentor-notes' } })}
              edge={colors.edgeAlt}
              travel={2}
              intent="navigate"
              radius={radius.pill}
              accessibilityLabel={t('journals.seeAll')}
              testID="journal-mentor-notes"
              style={[styles.seeAll, { backgroundColor: colors.surfaceAlt }]}
            >
              <Text style={[styles.seeAllText, { color: colors.accent }]}>{t('journals.seeAll')}</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.accent} />
            </PressKey>
          </View>
          {kept.length === 0 ? (
            <Text style={[type.caption, { color: colors.inkMuted }]}>{t('journals.emptyMentorNotes')}</Text>
          ) : (
            kept.slice(0, KEPT_PREVIEW).map((e) => (
              <EdgeSurface
                key={e.id}
                edge={colors.edgeSurface}
                travel={2}
                radius={radius.md}
                containerStyle={styles.keptRowSpacing}
                style={[styles.keptRow, { backgroundColor: colors.surface }]}
              >
                <Ionicons name="bookmark" size={16} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={2} style={[type.body, { color: colors.ink }]}>
                    {e.body}
                  </Text>
                  {e.meta.listener_persona ? (
                    <Text style={[type.caption, { color: colors.inkMuted }]}>{e.meta.listener_persona}</Text>
                  ) : null}
                </View>
              </EdgeSurface>
            ))
          )}
        </Entrance>

        {/* Quiet links: the AI helper is never the hero; Finance is honestly not ready. */}
        <Entrance index={4}>
          <PressKey
            onPress={() => router.push('/journal/organize')}
            edge={colors.edgeAlt}
            travel={2}
            intent="navigate"
            radius={radius.md}
            accessibilityLabel={t('journals.aiCta')}
            testID="journal-ai-organize"
            containerStyle={styles.quietSpacing}
            style={[styles.quiet, { backgroundColor: colors.surfaceAlt }]}
          >
            <Ionicons name="sparkles-outline" size={16} color={colors.accent} />
            <Text style={[styles.quietText, { color: colors.ink }]}>{t('journals.threads')}</Text>
            <View style={[styles.tag, { backgroundColor: colors.surface }]}>
              <Text style={[styles.tagText, { color: colors.accent }]}>{t('journals.beta')}</Text>
            </View>
          </PressKey>

          {hasFinance ? (
            <PressKey
              onPress={() => router.push({ pathname: '/journal/[channel]', params: { channel: 'finance' } })}
              edge={colors.edgeAlt}
              travel={2}
              intent="navigate"
              radius={radius.md}
              accessibilityLabel={t('journals.financeEarlier')}
              testID="journal-finance"
              containerStyle={styles.quietSpacing}
              style={[styles.quiet, { backgroundColor: colors.surfaceAlt }]}
            >
              <Ionicons name="wallet-outline" size={16} color={colors.inkMuted} />
              <Text style={[styles.quietText, { color: colors.ink }]}>{t('journals.financeEarlier')}</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.inkMuted} />
            </PressKey>
          ) : (
            <View style={[styles.soon, { borderColor: colors.border }]} testID="journal-finance-soon">
              <Ionicons name="wallet-outline" size={16} color={colors.inkMuted} />
              <Text style={[styles.quietText, { color: colors.inkMuted }]}>{t('journals.financeSoon')}</Text>
              <View style={[styles.tag, { backgroundColor: colors.surfaceAlt }]}>
                <Text style={[styles.tagText, { color: colors.inkMuted }]}>{t('journals.comingSoon')}</Text>
              </View>
            </View>
          )}
        </Entrance>
      </ScrollView>
      </CompanionPerches>
    </Screen>
  );
}

const styles = StyleSheet.create({
  writeTodayBox: { marginTop: space.sm },
  writeToday: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  todayWrap: { paddingTop: 36 },
  // Room above the Today card for whoever is perched on its top edge (decor only).
  furniture: { zIndex: 1 },
  card: { borderRadius: radius.lg, padding: space.md, gap: space.md },
  cardTitle: { fontFamily: font.sansHeavy, fontSize: 22, lineHeight: 28 },
  block: { gap: space.sm },
  eyebrow: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16, letterSpacing: 0.5, textTransform: 'uppercase' },
  kept: { borderRadius: radius.md, padding: space.sm + 4, gap: space.xs },
  moodBlock: { borderTopWidth: 1, paddingTop: space.md, gap: space.sm },
  moodRow: { flexDirection: 'row', gap: space.xs },
  moodCell: { flex: 1 },
  moodKey: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: 56, paddingHorizontal: 2 },
  moodLabel: { fontFamily: font.sansBold, fontSize: 11, lineHeight: 14 },
  section: { fontFamily: font.sansBold, fontSize: 18, lineHeight: 25, marginTop: space.lg, marginBottom: space.sm },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space.lg, marginBottom: space.sm },
  sectionInline: { marginTop: 0, marginBottom: 0 },
  writeRow: { flexDirection: 'row', gap: space.sm },
  writeCell: { flex: 1 },
  writeKey: { borderRadius: radius.lg, padding: space.sm + 4, gap: space.sm, minHeight: 104 },
  writeLabel: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 20 },
  shelf: { gap: space.sm, paddingRight: space.lg },
  dayCell: { width: 184 },
  dayCard: { borderRadius: radius.lg, padding: space.sm + 4, gap: space.sm, minHeight: 112 },
  dayLine: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2, borderRadius: radius.pill, paddingHorizontal: space.sm + 4, minHeight: 44 },
  seeAllText: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  keptRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, borderRadius: radius.md, padding: space.sm + 4 },
  keptRowSpacing: { marginBottom: space.sm },
  quiet: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.md, paddingHorizontal: space.sm + 4, minHeight: 48 },
  quietSpacing: { marginTop: space.md },
  quietText: { flex: 1, fontFamily: font.sansSemi, fontSize: 14, lineHeight: 20 },
  tag: { borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: space.sm },
  tagText: { fontFamily: font.sansBold, fontSize: 11, lineHeight: 16 },
  soon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingHorizontal: space.sm + 4,
    minHeight: 48,
    marginTop: space.md,
  },
});

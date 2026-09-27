import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CompanionPerches, CompanionSlot, useCompanionPlacement } from '@/components/art/PerchedCompanion';
import { DayBook, type KeptGroup } from '@/components/journal/DayBook';
import { JournalPageHeader } from '@/components/journal/JournalPageHeader';
import { DeepArrival } from '@/components/motion/DeepArrival';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { api, type ConversationListItem, type JournalEntry } from '@/lib/api';
import type { PlacementSlot } from '@/lib/companionPlacement';
import { useI18n } from '@/lib/i18n';
import {
  MERGED_CHANNELS,
  dayDate,
  dayId,
  daysAgo,
  earliestDay,
  isDayId,
  readDay,
  shiftDay,
} from '@/lib/journalDays';
import { screenCache } from '@/lib/screenCache';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/**
 * A past day (board A29) — one day from the shelf, opened as a small book. Previous / next
 * walk the CALENDAR, so a quiet day shows its blank page rather than being skipped; the
 * first day hands back to the shelf and yesterday hands on to Today (both = the hub).
 *
 * Data: the same merged read the hub does (its cache first, so the book opens at once),
 * grouped by local day in lib/journalDays.ts. Nothing new server-side.
 */
const PERCHES: PlacementSlot[] = [{ id: 'bookTop', type: 'top', level: 'high', home: true }];

export default function JournalDayScreen() {
  useSessionGuard();
  const router = useRouter();
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const params = useLocalSearchParams<{ date: string }>();
  const today = dayId(new Date());
  const date = isDayId(params.date) && params.date < today ? params.date : shiftDay(today, -1);

  const [entries, setEntries] = useState<JournalEntry[] | null>(screenCache.get('journal')?.entries ?? null);
  const [convos, setConvos] = useState<ConversationListItem[]>(screenCache.get('chats')?.rows ?? []);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const lists = await Promise.all(MERGED_CHANNELS.map((c) => api.listJournalEntries(c)));
      const all = lists.flat().sort((a, b) => b.created_at.localeCompare(a.created_at));
      setEntries(all);
      setFailed(false);
      const cached = screenCache.get('journal');
      screenCache.set('journal', { entries: all, hasFinance: cached?.hasFinance ?? false });
    } catch {
      // Still: the book keeps whatever it last showed.
      setFailed(true);
      setEntries((prev) => prev ?? []);
    }
    // The conversation gives the mentor's stable avatar seed (never the rotating name) and
    // what the chat route needs to open (channel + today's name).
    void api
      .listConversations()
      .then(setConvos)
      .catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // The companion sits on the book's cover. A long day scrolls the cover away under it, so
  // it is not drawn while the page is scrolled (it never floats over the writing).
  const [scrolled, setScrolled] = useState(false);
  const perch = useCompanionPlacement('journalDay', PERCHES, { still: failed, hidden: scrolled });

  const page = useMemo(() => readDay(entries ?? [], date), [entries, date]);
  const kept: KeptGroup[] = useMemo(() => {
    const groups: KeptGroup[] = [];
    for (const e of page.kept) {
      const conversationId = e.meta.conversation_id ? String(e.meta.conversation_id) : null;
      const name = e.meta.listener_persona ?? t('chat.yourListener');
      let g = groups.find((x) => x.key === `${conversationId}|${name}`);
      if (!g) {
        const convo = conversationId ? convos.find((c) => c.id === conversationId) : undefined;
        g = {
          key: `${conversationId}|${name}`,
          // A wiped chat has nothing left to open; an unknown one cannot be opened from here.
          conversationId: convo && convo.status !== 'wiped' ? conversationId : null,
          name,
          face: convo
            ? { animal: convo.listener_companion_animal, colour: convo.listener_companion_colour }
            : null,
          lines: [],
        };
        groups.push(g);
      }
      g.lines.push({ id: e.id, body: e.body });
    }
    return groups;
    // reason: `t` only feeds the nameless fallback; a locale flip re-renders through `page`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, convos]);

  const tag = locale === 'hi' ? 'hi-IN' : 'en-IN';
  const d = dayDate(date);
  const weekday = d.toLocaleDateString(tag, { weekday: 'long' });
  const dayMonth = d.toLocaleDateString(tag, { day: 'numeric', month: 'long' });
  const short = (id: string) => dayDate(id).toLocaleDateString(tag, { weekday: 'short', day: 'numeric' });
  const n = daysAgo(date);
  const ago = n === 1 ? t('journalPage.yesterday') : t('time.daysAgo', { count: n });

  const first = earliestDay(entries ?? []);
  const prevId = first && date > first ? shiftDay(date, -1) : null;
  const nextId = n > 1 ? shiftDay(date, 1) : null;
  const go = (id: string) => router.setParams({ date: id });
  const openChat = (id: string) => {
    const c = convos.find((x) => x.id === id);
    // A locked chat opens through My Chats' PIN gate, never around it.
    if (!c || c.is_locked) return router.navigate('/(tabs)/chats');
    router.push({
      pathname: '/chat/[id]',
      params: { id: c.id, listener: c.listener_persona_name, channel: c.stream_channel_id ?? '' },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <CompanionPerches placement={perch}>
        <View style={styles.page}>
          <JournalPageHeader
            onBack={() => router.back()}
            backLabel={t('journalPage.backA11y')}
            title={t('journals.hubTitle')}
            sub={t('journalPage.daySub')}
          />

          {/* The cover's top line: the companion stands on it, outside the scroll's clip. */}
          <View style={styles.coverLine} pointerEvents="none">
            {entries === null ? null : <CompanionSlot id="bookTop" size={60} inset={16} attach="floor" />}
          </View>

          <DeepArrival style={styles.column}>
            <ScrollView
              style={styles.fill}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scroll}
              scrollEventThrottle={64}
              onScroll={(e) => setScrolled(e.nativeEvent.contentOffset.y > 2)}
            >
              {entries === null ? null : (
                // Keyed by day: turning to another day arrives the book again.
                <Entrance key={date}>
                  <View>
                    <DayBook
                      ago={ago}
                      weekday={weekday}
                      date={dayMonth}
                      page={page}
                      kept={kept}
                      onOpenChat={openChat}
                    />
                  </View>
                </Entrance>
              )}
              {failed ? (
                <Text style={[type.caption, styles.failed, { color: colors.inkMuted }]}>{t('journals.loadError')}</Text>
              ) : null}
            </ScrollView>
          </DeepArrival>

          <Entrance index={2} style={styles.keys}>
            {prevId ? (
              <PressKey
                onPress={() => go(prevId)}
                edge={colors.edgeSurface}
                radius={radius.md}
                accessibilityLabel={`${t('journalPage.prevDay')}, ${short(prevId)}`}
                testID="day-prev"
                containerStyle={styles.keyBox}
                style={[styles.key, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Ionicons name="chevron-back" size={20} color={colors.ink} />
                <View>
                  <Text style={[styles.keyHint, { color: colors.inkMuted }]}>{t('journalPage.prevDay')}</Text>
                  <Text style={[styles.keyLabel, { color: colors.ink }]}>{short(prevId)}</Text>
                </View>
              </PressKey>
            ) : (
              <PressKey
                onPress={() => router.back()}
                edge={colors.edgeAlt}
                radius={radius.md}
                accessibilityLabel={`${t('journalPage.earlierDays')}, ${t('journalPage.onTheShelf')}`}
                testID="day-shelf"
                containerStyle={styles.keyBox}
                style={[styles.key, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
              >
                <Ionicons name="book-outline" size={20} color={colors.ink} />
                <View>
                  <Text style={[styles.keyHint, { color: colors.inkMuted }]}>{t('journalPage.earlierDays')}</Text>
                  <Text style={[styles.keyLabel, { color: colors.ink }]}>{t('journalPage.onTheShelf')}</Text>
                </View>
              </PressKey>
            )}
            {nextId ? (
              <PressKey
                onPress={() => go(nextId)}
                edge={colors.edgeSurface}
                radius={radius.md}
                accessibilityLabel={`${t('journalPage.nextDay')}, ${short(nextId)}`}
                testID="day-next"
                containerStyle={styles.keyBox}
                style={[styles.key, styles.keyRight, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <View style={styles.right}>
                  <Text style={[styles.keyHint, { color: colors.inkMuted }]}>{t('journalPage.nextDay')}</Text>
                  <Text style={[styles.keyLabel, { color: colors.ink }]}>{short(nextId)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.ink} />
              </PressKey>
            ) : (
              <PressKey
                onPress={() => router.back()}
                edge={colors.accentTintEdge}
                radius={radius.md}
                accessibilityLabel={`${t('journalPage.nextDay')}, ${t('journals.today')}`}
                testID="day-today"
                containerStyle={styles.keyBox}
                style={[styles.key, styles.keyRight, { backgroundColor: colors.accentTint, borderColor: colors.accentTintEdge }]}
              >
                <View style={styles.right}>
                  <Text style={[styles.keyHint, { color: colors.ink }]}>{t('journalPage.nextDay')}</Text>
                  <Text style={[styles.keyLabel, { color: colors.accentEdge }]}>{t('journals.today')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.accentEdge} />
              </PressKey>
            )}
          </Entrance>
        </View>
      </CompanionPerches>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  fill: { flex: 1, minHeight: 0 },
  page: { flex: 1, paddingTop: space.xs, paddingHorizontal: space.lg, paddingBottom: space.lg, gap: 12 },
  coverLine: { height: 0, marginTop: 16, zIndex: 3 },
  column: { flex: 1, minHeight: 0, marginTop: -12 },
  // Room below the book for its ribbon.
  scroll: { paddingBottom: 20 },
  failed: { paddingTop: space.md, textAlign: 'center' },
  keys: { flexDirection: 'row', gap: 12 },
  keyBox: { flex: 1 },
  key: { height: 56, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1 },
  keyRight: { justifyContent: 'flex-end' },
  right: { alignItems: 'flex-end' },
  keyHint: { fontFamily: font.sans, fontSize: 12, lineHeight: 14 },
  keyLabel: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 20 },
});

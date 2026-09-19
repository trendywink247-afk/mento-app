import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { CompanionPerches, CompanionSlot, useCompanionPlacement } from '@/components/art/PerchedCompanion';
import { BoardSheet, type BoardSheetHandle } from '@/components/motion/BoardSheet';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { ApiError, api } from '@/lib/api';
import type { PlacementSlot } from '@/lib/companionPlacement';
import { useI18n, type TKey } from '@/lib/i18n';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, wash, washInk } from '@/theme/tokens';

/**
 * New chat (board A24) — a sheet over My Chats, which settles back under it
 * (components/motion/BoardSheet.tsx). Two doors, six optional topic chips, one honest
 * line. It never mints a conversation by itself: the member chooses a door first.
 *
 * The chosen topic travels as `issue_category` — to `POST /match` for the first door, and
 * on to Browse → the Personal request for the second — so the chat header's topic chip is
 * finally fed. Chips map onto the server's slugs (services/api categories.py). Two chips
 * have no slug there yet ("Feeling stuck", "Motivation"): their own slug is sent and
 * stored, and the header chip appears for them once the server names them.
 *
 * A screens-backed `transparentModal` route, not an RN <Modal> (blank on Android new arch).
 */
const TOPICS: { slug: string; label: TKey }[] = [
  { slug: 'feeling_stuck', label: 'newChat.topicStuck' },
  { slug: 'exam_stress', label: 'newChat.topicExam' },
  { slug: 'motivation', label: 'newChat.topicMotivation' },
  { slug: 'family', label: 'newChat.topicFamily' },
  { slug: 'loneliness', label: 'newChat.topicLoneliness' },
  { slug: 'life', label: 'newChat.topicTalk' },
];

const PERCHES: PlacementSlot[] = [{ id: 'sheetEdge', type: 'top', level: 'mid', home: true }];

export default function NewChatSheet() {
  useSessionGuard();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const sheet = useRef<BoardSheetHandle | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // "Everyone is busy" is a still state: the companion sits, nothing moves.
  const perch = useCompanionPlacement('newChat', PERCHES, { still: note !== null });

  const leave = () => router.back();

  const nextAvailable = async () => {
    if (matching) return;
    setMatching(true);
    setNote(null);
    try {
      const match = await api.match({ kind: 'general', issue_category: topic });
      sheet.current?.close(() =>
        router.replace({
          pathname: '/chat/[id]',
          params: {
            id: match.conversation_id,
            listener: match.listener_persona_name,
            channel: match.stream_channel_id ?? '',
          },
        }),
      );
    } catch (e) {
      setNote(e instanceof ApiError && e.status === 503 ? t('common.allBusy') : t('common.networkError'));
      setMatching(false);
    }
  };

  const pickMentor = () => {
    if (matching) return;
    sheet.current?.close(() => {
      router.back();
      router.push({ pathname: '/(tabs)/mentors', params: topic ? { topic } : {} });
    });
  };

  return (
    <CompanionPerches placement={perch}>
      <BoardSheet
        controller={sheet}
        onDismiss={leave}
        dismissLabel={t('newChat.closeA11y')}
        testID="new-chat-sheet"
        backdropTestID="new-chat-backdrop"
        top={<CompanionSlot id="sheetEdge" size={60} inset={30} />}
      >
        <Entrance index={2} style={styles.head}>
          <Text style={[type.sheetTitle, { color: colors.ink }]} accessibilityRole="header">
            {t('newChat.titleLead')}
            <Text style={{ color: colors.accent }}>{t('newChat.titleAccent')}</Text>
            {t('newChat.titleTail')}
          </Text>
          <Text style={[type.bodySmall, { color: colors.inkMuted }]}>{t('chats.newChatBody')}</Text>
        </Entrance>

        <View style={styles.doors}>
          <Entrance index={3}>
            <PressKey
              onPress={() => void nextAvailable()}
              edge={colors.edgeSurface}
              radius={radius.lg}
              intent="commit"
              accessibilityLabel={t('chats.newChatNow')}
              accessibilityHint={t('chats.newChatNowSub')}
              testID="new-chat-now"
              style={[styles.door, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={[styles.doorIcon, { backgroundColor: colors.accentTint }]}>
                <Ionicons name="flash-outline" size={24} color={colors.accent} />
              </View>
              <View style={styles.doorText}>
                <Text style={[styles.doorTitle, { color: colors.ink }]}>{t('chats.newChatNow')}</Text>
                <Text style={[type.note, { color: colors.inkMuted }]}>{t('chats.newChatNowSub')}</Text>
              </View>
              {matching ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Ionicons name="chevron-forward" size={20} color={colors.inkMuted} />
              )}
            </PressKey>
          </Entrance>
          <Entrance index={4}>
            <PressKey
              onPress={pickMentor}
              edge={colors.edgeAlt}
              radius={radius.lg}
              accessibilityLabel={t('chats.newChatPick')}
              accessibilityHint={t('chats.newChatPickSub')}
              testID="new-chat-pick"
              style={[styles.door, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
            >
              <View style={[styles.doorIcon, { backgroundColor: wash.green }]}>
                <Ionicons name="people-outline" size={24} color={washInk.green} />
              </View>
              <View style={styles.doorText}>
                <Text style={[styles.doorTitle, { color: colors.ink }]}>{t('chats.newChatPick')}</Text>
                <Text style={[type.note, { color: colors.inkMuted }]}>{t('chats.newChatPickSub')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.inkMuted} />
            </PressKey>
          </Entrance>
        </View>

        {note ? (
          // Still on purpose (T&S #11): no arrival, no haptic.
          <Text style={[type.note, styles.note, { color: colors.ink, backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} testID="new-chat-note">
            {note}
          </Text>
        ) : null}

        <Entrance index={5} style={styles.topics}>
          <View style={styles.topicsHead}>
            <Text style={[type.label, { color: colors.ink }]}>{t('newChat.aboutTitle')}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{t('newChat.aboutHint')}</Text>
          </View>
          <View style={styles.grid} accessibilityLabel={t('newChat.aboutA11y')}>
            {TOPICS.map((tp) => {
              const on = topic === tp.slug;
              return (
                <View key={tp.slug} style={styles.topicCell}>
                <PressKey
                  onPress={() => setTopic(on ? null : tp.slug)}
                  edge={on ? colors.accentTintEdge : colors.edgeSurface}
                  radius={radius.pill}
                  intent="select"
                  accessibilityState={{ selected: on }}
                  testID={`new-chat-topic-${tp.slug}`}
                  style={[
                    styles.topic,
                    on
                      ? { backgroundColor: colors.accentTint, borderColor: colors.accent, borderWidth: 2 }
                      : { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                >
                  <Text
                    style={[styles.topicText, { color: on ? colors.accentEdge : colors.ink }]}
                    numberOfLines={2}
                    adjustsFontSizeToFit
                  >
                    {t(tp.label)}
                  </Text>
                </PressKey>
                </View>
              );
            })}
          </View>
        </Entrance>

        <Entrance index={6} style={styles.tail}>
          <View style={styles.oneLine}>
            <Ionicons name="chatbubble-outline" size={15} color={colors.inkMuted} />
            <Text style={[type.caption, { color: colors.inkMuted }]}>{t('newChat.oneAtATime')}</Text>
          </View>
          <PressKey
            onPress={() => sheet.current?.close()}
            edge="transparent"
            travel={2}
            radius={radius.pill}
            haptic="none"
            accessibilityLabel={t('chats.newChatCancel')}
            testID="new-chat-cancel"
            style={styles.notNow}
          >
            <Text style={[styles.notNowText, { color: colors.accent }]}>{t('chats.newChatCancel')}</Text>
          </PressKey>
        </Entrance>
      </BoardSheet>
    </CompanionPerches>
  );
}

const styles = StyleSheet.create({
  head: { gap: 4 },
  doors: { gap: 12 },
  door: { minHeight: 92, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1 },
  doorIcon: { width: 48, height: 48, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  doorText: { flex: 1, minWidth: 0, gap: 2 },
  doorTitle: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 22 },
  note: { padding: space.sm + 4, borderRadius: radius.md, borderWidth: 1 },
  topics: { paddingTop: 2, gap: space.sm },
  topicsHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4, rowGap: 4 },
  topicCell: { width: '33.333%', paddingHorizontal: 4 },
  topic: { height: 44, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  topicText: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 16, textAlign: 'center' },
  tail: { alignItems: 'center', gap: 2 },
  oneLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  notNow: { height: 44, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
  notNowText: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 20 },
});

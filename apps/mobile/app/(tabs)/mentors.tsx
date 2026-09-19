import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { Screen } from '@/components/Screen';
import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { PressKey } from '@/components/motion/PressKey';
import { ApiError, api, type Listener } from '@/lib/api';
import { formatTopic } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { screenCache } from '@/lib/screenCache';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/** Mentor discovery (SCOPE §5): anonymous persona cards, life/emotional filter pills,
 * availability sections, no star ratings. Tap → profile + intro request. */
export default function MentorsTab() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  // Last-loaded list first, quiet refresh on focus; spinner only with nothing to show yet
  // (lib/screenCache.ts). Presence moves, so the refresh always runs.
  const cachedMentors = screenCache.get('mentors');
  const [loading, setLoading] = useState(!cachedMentors);
  const [listeners, setListeners] = useState<Listener[]>(cachedMentors ?? []);
  const [category, setCategory] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void api
        .listListeners()
        .then((l) => {
          screenCache.set('mentors', l);
          if (active) setListeners(l);
        })
        .catch(() => {})
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  const nextAvailable = async () => {
    if (matching) return;
    setMatching(true);
    setNote(null);
    try {
      const match = await api.match({ kind: 'general' });
      router.push({
        pathname: '/chat/[id]',
        params: {
          id: match.conversation_id,
          listener: match.listener_persona_name,
          channel: match.stream_channel_id ?? '',
        },
      });
    } catch (e) {
      setNote(
        e instanceof ApiError && e.status === 503
          ? t('common.allBusy')
          : t('common.networkError'),
      );
    } finally {
      setMatching(false);
    }
  };

  const categories = [...new Set(listeners.flatMap((l) => l.categories))];
  const filtered = category
    ? listeners.filter((l) => l.categories.includes(category))
    : listeners;
  const availableNow = filtered.filter((l) => l.available);
  const others = filtered.filter((l) => !l.available);

  const renderCard = (l: Listener) => (
    <PressKey
      key={l.id}
      onPress={() => router.push({ pathname: '/mentor/[id]', params: { id: l.id } })}
      edge={colors.edgeSurface}
      accessibilityLabel={`Mentor ${l.persona_name}`}
      testID={`mentor-${l.id}`}
      style={[styles.card, { backgroundColor: colors.surface }]}
    >
      <PersonaAvatar name={l.persona_name} size={52} online={l.available} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.cardName, { color: colors.ink }]}>{l.persona_name}</Text>
        <Text style={[type.caption, { color: l.available ? colors.success : colors.inkMuted }]}>
          {l.available ? '● Available now' : l.status === 'online' ? 'At capacity' : 'Away'}
        </Text>
        {l.categories.length ? (
          <View style={styles.tagRow}>
            {l.categories.slice(0, 3).map((c) => (
              <View key={c} style={[styles.tag, { backgroundColor: colors.surfaceAlt }]}>
                <Text style={[styles.tagText, { color: colors.accent }]}>{formatTopic(c)}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {l.is_favourite ? (
        <View
          testID={`mentor-favourite-${l.id}`}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('mentors.favourite')}
        >
          <Ionicons name="heart" size={18} color={colors.accent} />
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
    </PressKey>
  );

  return (
    <Screen>
      <Text style={[type.displaySerif, { color: colors.ink }]} accessibilityRole="header">
        Mentors
      </Text>
      <Text style={[type.body, { color: colors.inkMuted, marginBottom: space.sm }]}>
        Real people, here to listen — always private.
      </Text>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={[1]}
          keyExtractor={() => 'mentors'}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: space.lg }}
          renderItem={() => (
            <View style={{ gap: space.sm }}>
              <PressKey
                onPress={() => void nextAvailable()}
                edge={colors.edgeAlt}
                testID="next-available"
                style={[styles.nextCard, { backgroundColor: colors.surfaceAlt }]}
              >
                <IconBadge icon="flash-outline" size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.label, { color: colors.ink }]}>Next Available Mentor</Text>
                  <Text style={[type.caption, { color: colors.inkMuted }]}>
                    Skip the browsing — we'll connect you right away.
                  </Text>
                </View>
                {matching ? (
                  <ActivityIndicator color={colors.accent} />
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={colors.accent} />
                )}
              </PressKey>

              {note ? (
                <View style={[styles.note, { backgroundColor: colors.surfaceAlt }]}>
                  <Text style={[type.caption, { color: colors.ink }]}>{note}</Text>
                </View>
              ) : null}

              {categories.length ? (
                <View style={styles.chips}>
                  <PressKey
                    onPress={() => setCategory(null)}
                    edge={category === null ? colors.accentEdge : colors.edgeSurface}
                    travel={3}
                    radius={radius.pill}
                    style={[
                      styles.chip,
                      category === null
                        ? { backgroundColor: colors.accent }
                        : { borderWidth: 1, borderColor: colors.accentSoft },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: category === null ? colors.onAccent : colors.accent }]}>
                      All
                    </Text>
                  </PressKey>
                  {categories.map((c) => {
                    const selected = category === c;
                    return (
                      <PressKey
                        key={c}
                        onPress={() => setCategory(selected ? null : c)}
                        edge={selected ? colors.accentEdge : colors.edgeSurface}
                        travel={3}
                        radius={radius.pill}
                        accessibilityState={{ selected }}
                        style={[
                          styles.chip,
                          selected
                            ? { backgroundColor: colors.accent }
                            : { borderWidth: 1, borderColor: colors.accentSoft },
                        ]}
                      >
                        <Text style={[styles.chipText, { color: selected ? colors.onAccent : colors.accent }]}>
                          {formatTopic(c)}
                        </Text>
                      </PressKey>
                    );
                  })}
                </View>
              ) : null}

              {availableNow.length ? (
                <>
                  <Text style={[styles.section, { color: colors.ink }]}>Available now</Text>
                  {availableNow.map(renderCard)}
                </>
              ) : null}
              {others.length ? (
                <>
                  <Text style={[styles.section, { color: colors.ink }]}>More mentors</Text>
                  {others.map(renderCard)}
                </>
              ) : null}
              {!availableNow.length && !others.length ? (
                <View style={styles.center}>
                  <IconBadge icon="people-outline" tone="indigo" size={64} />
                  <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
                    No mentors match that filter right now.
                  </Text>
                </View>
              ) : null}

              <View style={[styles.privacy, { backgroundColor: colors.surfaceAlt }]}>
                <Ionicons name="shield-checkmark-outline" size={16} color={colors.accentSoft} />
                <Text style={[type.caption, { color: colors.inkMuted, flex: 1 }]}>
                  Mentors are listeners, not therapists. No star ratings here — just real people
                  and real appreciation.
                </Text>
              </View>
            </View>
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.xl },
  nextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.md,
  },
  note: { borderRadius: radius.md, padding: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginVertical: space.xs },
  chip: { borderRadius: radius.pill, paddingVertical: space.xs + 2, paddingHorizontal: space.sm + 4 },
  chipText: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  section: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 22, marginTop: space.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.sm + 2,
  },
  cardName: { fontFamily: font.serifBold, fontSize: 18, lineHeight: 24 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginTop: space.xs },
  tag: { borderRadius: radius.pill, paddingVertical: 2, paddingHorizontal: space.sm },
  tagText: { fontFamily: font.sansSemi, fontSize: 11, lineHeight: 16 },
  privacy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.sm,
  },
});

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Companion, type CompanionTrigger } from '@/components/art/Companion';
import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { Entrance } from '@/components/motion/Entrance';
import { capture } from '@/lib/analytics';
import { api, type ListenerProfile, type PathTree } from '@/lib/api';
import { cachedPathTree, communityLabel } from '@/lib/communityLabel';
import { formatTopic } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { pendingOption } from '@/lib/pendingOption';
import { useCompanionAnimal } from '@/lib/useCompanionAnimal';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { duration } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/**
 * "Two in the room" (spec §3.2) — the member-side mentor profile, pushed from the
 * chat header. Keyed by the CONVERSATION id (not the listener id): the chat route
 * only knows the conversation + the persona name it was given at match time, and the
 * server derives the listener from the conversation, so no listener id needs to
 * travel through route params. The persona name from params renders immediately;
 * `GET /conversations/{id}/mentor` fills in the rest.
 */

function monthYear(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric' }).format(d);
}

function FactRow({
  icon,
  label,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <EdgeSurface
      edge={colors.edgeSurface}
      travel={2}
      radius={radius.md}
      style={[styles.factRow, { backgroundColor: colors.surface }]}
      containerStyle={styles.factContainer}
      testID={testID}
    >
      <Ionicons name={icon} size={16} color={colors.inkMuted} />
      <Text style={[type.body, { color: colors.ink, flex: 1 }]}>{label}</Text>
    </EdgeSurface>
  );
}

export default function MentorProfileScreen() {
  useSessionGuard();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const animal = useCompanionAnimal();
  const { id: conversationId, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const fallbackName = name ?? t('chat.yourListener');

  const [profile, setProfile] = useState<ListenerProfile | null>(null);
  const [tree, setTree] = useState<PathTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favourite, setFavourite] = useState(false);
  const [favouriteBusy, setFavouriteBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [trigger, setTrigger] = useState<CompanionTrigger>(null);
  const viewedRef = useRef(false);
  const saveErrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(() => {
    if (!conversationId) return;
    setLoading(true);
    setError(null);
    void api
      .mentorProfile(conversationId)
      .then((p) => {
        setProfile(p);
        setFavourite(p.is_favourite);
      })
      .catch(() => setError(t('common.networkError')))
      .finally(() => setLoading(false));
  }, [conversationId, t]);

  useEffect(() => {
    load();
  }, [load]);

  // Community labels are a nice-to-have polish, never a blocker — fetched once,
  // best-effort, and simply ignored on failure (falls back to a title-cased slug).
  useEffect(() => {
    void cachedPathTree().then(setTree).catch(() => {});
  }, []);

  useEffect(() => {
    if (!viewedRef.current) {
      viewedRef.current = true;
      capture('mentor_profile_viewed');
    }
  }, []);

  useEffect(() => {
    if (reduced) return;
    const timer = setTimeout(() => setTrigger({ kind: 'curious', n: 1 }), 400);
    return () => clearTimeout(timer);
  }, [reduced]);

  useEffect(
    () => () => {
      if (saveErrorTimer.current) clearTimeout(saveErrorTimer.current);
    },
    [],
  );

  const toggleFavourite = () => {
    if (!profile || favouriteBusy) return;
    const next = !favourite;
    setFavourite(next); // optimistic
    setSaveError(false);
    setFavouriteBusy(true);
    capture('mentor_favourited', { on: next });
    void api
      .favouriteListener(profile.id, next)
      .catch(() => {
        setFavourite(!next); // revert
        setSaveError(true);
        if (saveErrorTimer.current) clearTimeout(saveErrorTimer.current);
        saveErrorTimer.current = setTimeout(() => setSaveError(false), duration.slow);
      })
      .finally(() => setFavouriteBusy(false));
  };

  const reportOrBlock = () => {
    pendingOption.set(conversationId ?? '', 'report');
    router.back();
  };

  const displayName = profile?.persona_name ?? fallbackName;
  const online = profile?.status === 'online';

  return (
    <Screen onBack={() => router.back()} scroll>
      <Entrance index={0}>
        {/* `animal` is undefined while the stored choice is still loading, null once
            read and there truly is none — only the latter falls back to the avatar-only
            layout. Reserving the two-up row's height (and leaving the companion slot
            blank) while undefined means a normal open — which always resolves to an
            animal — never jumps layout once it lands. */}
        <View style={[styles.hero, { minHeight: 120 }]}>
          {animal === undefined ? (
            <View style={styles.heroRow}>
              <View style={styles.heroPlaceholder} />
              <PersonaAvatar name={displayName} size={78} online={online} />
            </View>
          ) : animal ? (
            <View style={styles.heroRow}>
              <Companion animal={animal} size={120} awake trigger={trigger} />
              <PersonaAvatar name={displayName} size={78} online={online} />
            </View>
          ) : (
            <PersonaAvatar name={displayName} size={96} online={online} />
          )}
        </View>
      </Entrance>

      <Entrance index={1}>
        <View style={styles.nameBlock}>
          <Text style={[type.displayHeadline, { color: colors.ink, textAlign: 'center' }]}>
            {displayName}
          </Text>
          <Text style={[type.caption, { color: colors.inkMuted, textAlign: 'center' }]}>
            {online ? t('mentorProfile.online') : t('mentorProfile.away')}
            {profile?.availability_note ? ` · ${t('mentorProfile.usually', { note: profile.availability_note })}` : ''}
          </Text>
        </View>
      </Entrance>

      {profile?.public_line ? (
        <Entrance index={2}>
          <View
            style={[styles.publicLine, { borderLeftColor: colors.accentTint }]}
            testID="public-line"
          >
            <Text style={[type.body, styles.publicLineText, { color: colors.ink }]}>
              “{profile.public_line}”
            </Text>
          </View>
        </Entrance>
      ) : null}

      {profile && (profile.categories.length || profile.community_slug) ? (
        <Entrance index={3}>
          <View style={styles.chips}>
            {profile.categories.map((c) => (
              <View key={c} style={[styles.chip, { backgroundColor: colors.surfaceAlt }]}>
                <Text style={[styles.chipText, { color: colors.accent }]}>{formatTopic(c)}</Text>
              </View>
            ))}
            {profile.community_slug ? (
              <View style={[styles.chip, { backgroundColor: colors.surfaceAlt }]}>
                <Text style={[styles.chipText, { color: colors.success }]}>
                  {communityLabel(tree, profile.community_slug)}
                </Text>
              </View>
            ) : null}
          </View>
        </Entrance>
      ) : null}

      {profile ? (
        <Entrance index={4}>
          <View style={styles.facts}>
            {profile.conversations_held >= 1 ? (
              <FactRow
                icon="people-outline"
                label={t('mentorProfile.talkedWith', { count: profile.conversations_held })}
                testID="fact-talked-with"
              />
            ) : null}
            <FactRow
              icon="calendar-outline"
              label={t('mentorProfile.since', { month: monthYear(profile.listening_since) })}
              testID="fact-since"
            />
            <FactRow
              icon="eye-outline"
              label={`${t('mentorProfile.sees')} · ${t('mentorProfile.seesValue')}`}
              testID="fact-sees"
            />
          </View>
        </Entrance>
      ) : null}

      <Entrance index={5}>
        <Text style={[type.caption, styles.pledge, { color: colors.inkMuted }]}>
          {t('mentorProfile.pledge')}
        </Text>
      </Entrance>

      {error ? (
        <View style={styles.errorBlock}>
          <Text style={[type.body, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
          <PrimaryButton
            label={t('common.retry')}
            variant="ghost"
            onPress={load}
            testID="retry"
          />
        </View>
      ) : null}

      {loading && !profile ? (
        <View style={styles.errorBlock}>
          <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
            {t('chat.opening')}
          </Text>
        </View>
      ) : null}

      {profile ? (
        <Entrance index={6} style={styles.actions}>
          <PrimaryButton
            label={
              favourite
                ? t('mentorProfile.saved', { name: displayName })
                : t('mentorProfile.askAgain', { name: displayName })
            }
            icon={favourite ? 'heart' : 'heart-outline'}
            onPress={toggleFavourite}
            disabled={favouriteBusy}
            testID="favourite-toggle"
          />
          {saveError ? (
            <Text style={[type.caption, styles.saveError, { color: colors.danger }]}>
              {t('mentorProfile.saveFailed')}
            </Text>
          ) : null}
          <PrimaryButton
            label={t('mentorProfile.reportBlock')}
            variant="ghost"
            onPress={reportOrBlock}
            testID="report-block"
          />
        </Entrance>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginTop: space.sm, marginBottom: space.md },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.md },
  heroPlaceholder: { width: 120, height: 120 },
  nameBlock: { alignItems: 'center', gap: space.xs, marginBottom: space.md },
  publicLine: {
    borderLeftWidth: 3,
    paddingLeft: space.md,
    marginBottom: space.md,
  },
  publicLineText: { fontFamily: font.sans, fontStyle: 'italic' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md, justifyContent: 'center' },
  chip: { borderRadius: radius.pill, paddingVertical: space.xs + 2, paddingHorizontal: space.sm + 4 },
  chipText: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  facts: { gap: space.sm, marginBottom: space.md },
  factRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm + 2 },
  factContainer: {},
  pledge: { textAlign: 'center', marginBottom: space.lg },
  errorBlock: { alignItems: 'center', gap: space.sm, marginVertical: space.lg },
  actions: { gap: space.sm, marginBottom: space.lg },
  saveError: { textAlign: 'center' },
});

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApplicationForm } from '@/components/ApplicationForm';
import { ApplicationStatusCard } from '@/components/mentor/ApplicationStatusCard';
import { EdgeSurface } from '@/components/EdgeSurface';
import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Companion } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { ConversationRow } from '@/components/mentor/ConversationRow';
import { PresenceHeader } from '@/components/mentor/PresenceHeader';
import { RequestCard } from '@/components/mentor/RequestCard';
import { StayInTouchRow } from '@/components/mentor/StayInTouchRow';
import { StayInTouchSheet } from '@/components/mentor/StayInTouchSheet';
import { SettleBack } from '@/components/motion/SettleBack';
import { Entrance } from '@/components/motion/Entrance';
import { Tilt3D } from '@/components/motion/Tilt3D';
import { api, type ListenerApplication } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { useI18n } from '@/lib/i18n';
import { listenerApi, type StayInTouchAsk } from '@/lib/listenerApi';
import { getListenerToken, saveListenerToken } from '@/lib/listenerSession';
import { setDraft } from '@/lib/onboardingDraft';
import { getCompanionAnimal, getPersona, saveRole, type Persona } from '@/lib/session';
import { registerPush } from '@/lib/pushNotifications';
import { useMentorConsole } from '@/lib/useMentorConsole';
import { useListenerHeartbeat } from '@/lib/useListenerHeartbeat';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/** Mentor Home (DECISIONS §K.7): the mentor branch's landing, and — once approved —
 * the native console itself (spec 2026-09-05). Outside the tab shell. Hosts the
 * shared ApplicationForm inline (no application yet), the status card (pending /
 * declined), the console (approved), and a quiet switch back to the talking side. */
export default function MentorHome() {
  useSessionGuard();
  const router = useRouter();
  const { colors, elevation } = useTheme();
  const { t } = useI18n();
  const [persona, setPersona] = useState<Persona | null>(null);
  const [animal, setAnimal] = useState<CompanionAnimal | null>(null);
  // undefined = still loading; null = no application on file.
  const [application, setApplication] = useState<ListenerApplication | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [switching, setSwitching] = useState(false);
  // Board A15: the stay-in-touch decision sheet over a settled-back Mentor Home.
  const [sheet, setSheet] = useState<{ ask: StayInTouchAsk; seats: number } | null>(null);
  const [asksVersion, setAsksVersion] = useState(0);
  // A member brief's "asked to stay in touch" row comes back here with ?ask=<id>.
  const { ask: askParam } = useLocalSearchParams<{ ask?: string }>();
  // null = not attempted / minting; true = a listener token is on device and
  // usable; 'unavailable' = we tried and the credential couldn't be minted.
  const [consoleReady, setConsoleReady] = useState<boolean | 'unavailable' | null>(null);
  const approvedHapticFired = useRef(false);
  // Tracks an in-flight api.consoleSession() mint — read only during the
  // consoleReady === null render to decide spinner vs. unavailable card, so a
  // failed/uncalled mint can never leave the screen on an endless spinner.
  const minting = useRef(false);

  // Best-effort — a persona/animal fetch failure should never blank the hero or
  // block the application status from loading.
  const loadIdentity = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([getPersona(), getCompanionAnimal()]);
      setPersona(p);
      setAnimal(a as CompanionAnimal | null);
    } catch {
      // ignore — hero renders fine with a null persona/companion.
    }
  }, []);

  // A listener token already on device is reused as-is; otherwise mint a fresh
  // console session (this is also the re-mint path after a session-lost signal —
  // listenerApi already cleared the stale token by the time this runs, so
  // getListenerToken() correctly falls through to a fresh mint). Never throws —
  // callers just get 'unavailable'.
  const ensureConsole = useCallback(async () => {
    if (await getListenerToken()) {
      setConsoleReady(true);
      return;
    }
    minting.current = true;
    try {
      const cs = await api.consoleSession();
      await saveListenerToken(cs.listener_token);
      setConsoleReady(true);
    } catch {
      setConsoleReady('unavailable');
    } finally {
      minting.current = false;
    }
  }, []);

  const loadApplication = useCallback(async () => {
    try {
      const app = await api.getListenerApplication();
      setApplication(app);
      setLoadError(false);
      if (app?.status === 'approved') await ensureConsole();
      else setConsoleReady(null);
    } catch {
      // Leave `application` as-is (no spinner flash, no accidental form reveal —
      // an unknown status must never show the form, that risks a duplicate apply).
      setLoadError(true);
    }
  }, [ensureConsole]);

  const load = useCallback(async () => {
    await Promise.all([loadIdentity(), loadApplication()]);
  }, [loadIdentity, loadApplication]);

  // Status can change while the app is backgrounded (admin approves) — refetch on focus.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // One arrival haptic, only for the approved state, only once per mount.
  useEffect(() => {
    if (application?.status === 'approved' && !approvedHapticFired.current) {
      approvedHapticFired.current = true;
      haptic.success();
    }
  }, [application]);

  const switchToTalk = async () => {
    if (switching) return;
    setSwitching(true);
    try {
      // Mentors never chose a companion. The chosen animal is the star of the talking
      // side (DECISIONS §I.5), so a first switch walks the rest of the member journey —
      // companion → ready → connecting — on the SAME account. The role flips to
      // mentee only once the pick is made (OnboardingJourney), so backing out leaves
      // them a mentor.
      if (!(await getCompanionAnimal())) {
        setDraft({ role: 'mentee', sessionBacked: true });
        router.dismissAll();
        router.replace({ pathname: '/onboarding', params: { step: 'companion' } });
        return;
      }
      await saveRole('mentee');
      router.dismissAll();
      router.replace('/chats');
    } catch {
      // Stay still and silent (T&S: no shaking/buzzing at a struggling user) —
      // release the spinner so the button is tappable again.
      setSwitching(false);
    }
  };

  const showConsole = application?.status === 'approved' && consoleReady === true;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <SettleBack
        open={!!sheet}
        onDismiss={() => setSheet(null)}
        dismissLabel={t('mentorInTouch.later')}
        sheetLabel={t('mentorInTouch.sheetA11y')}
        sheet={
          sheet ? (
            <StayInTouchSheet
              key={sheet.ask.id}
              ask={sheet.ask}
              seats={sheet.seats}
              onAnswered={() => setAsksVersion((n) => n + 1)}
              onClose={() => setSheet(null)}
            />
          ) : null
        }
      >
        <ScrollView
          contentContainerStyle={[styles.content, !showConsole && styles.contentWide]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
      {!showConsole ? (
        <Entrance index={0}>
          <View style={styles.hero} testID="mentor-home">
            <Tilt3D maxTilt={6}>
              <Companion animal={animal} size={96} />
            </Tilt3D>
            <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
              {t('mentorHome.title')}
            </Text>
            {persona ? (
              <Text style={[type.caption, { color: colors.inkMuted }]}>
                {t('mentorHome.appearAs', { name: persona.persona_name })}
              </Text>
            ) : null}
          </View>
        </Entrance>
      ) : null}

      {loadError ? (
        <Entrance index={1}>
          <View style={[styles.card, elevation.sm, { backgroundColor: colors.surface }]} testID="mentor-load-error">
            <Text style={[type.body, { color: colors.ink }]}>{t('mentorHome.loadError')}</Text>
            <PrimaryButton label={t('connecting.tryAgain')} variant="ghost" onPress={() => void load()} testID="mentor-retry" />
          </View>
        </Entrance>
      ) : application === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : application === null ? (
        <Entrance index={1}>
          <Text style={[type.body, styles.intro, { color: colors.inkMuted }]}>{t('mentorHome.applyIntro')}</Text>
          <ApplicationForm onSuccess={(result) => setApplication(result)} />
        </Entrance>
      ) : application.status === 'declined' ? (
        <Entrance index={1}>
          <ApplicationStatusCard state="declined" application={application} animal={animal} />
          {/* The server owns the 30-day reapply cooldown (anchored on decline time,
              which this client doesn't have) — always offer the form and let its
              own error display surface a 409 if it's too soon, exactly like the
              Profile → apply path already does. */}
          <Text style={[type.body, styles.intro, { color: colors.inkMuted }]}>{t('mentorHome.applyIntro')}</Text>
          <ApplicationForm onSuccess={(result) => setApplication(result)} />
        </Entrance>
      ) : application.status === 'approved' ? (
        consoleReady === true ? (
          <ConsoleBody
            animal={animal}
            asksVersion={asksVersion}
            openAskId={typeof askParam === 'string' ? askParam : undefined}
            onOpenAsk={(ask, seats) => setSheet({ ask, seats })}
            onSessionLost={() => {
              // The token's already cleared (listenerApi does that before this
              // fires) — re-mint immediately rather than stranding the mentor on
              // the null/loading state with nothing driving it forward.
              setConsoleReady(null);
              void ensureConsole();
            }}
          />
        ) : consoleReady === 'unavailable' || (consoleReady === null && !minting.current) ? (
          <Entrance index={1}>
            <EdgeSurface
              edge={colors.edgeSurface}
              style={[styles.card, styles.row, { backgroundColor: colors.surface }]}
              testID="mentor-status"
            >
              <IconBadge icon="checkmark-circle-outline" tone="green" size={44} />
              <View style={{ flex: 1 }}>
                <Text style={[type.label, { color: colors.ink }]}>{t('profile.approvedTitle')}</Text>
                <Text style={[type.caption, { color: colors.inkMuted }]}>{t('profile.approvedBody')}</Text>
                <Text style={[type.caption, styles.unavailable, { color: colors.warning }]}>
                  {t('mentor.consoleUnavailable')}
                </Text>
              </View>
            </EdgeSurface>
            <PrimaryButton
              label={t('mentor.consoleRetry')}
              variant="ghost"
              onPress={() => void ensureConsole()}
              testID="mentor-console-retry"
            />
          </Entrance>
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        )
      ) : (
        <ApplicationStatusCard
          state="review"
          application={application}
          animal={animal}
          onRead={() => router.push('/mentor/reading')}
        />
      )}

      <View style={styles.grow} />
      <Entrance index={showConsole ? 5 : 2} style={styles.foot}>
        {showConsole ? (
          <Text style={[type.caption, styles.centerText, { color: colors.inkMuted }]}>{t('mentorHomePage.footer')}</Text>
        ) : null}
        <PrimaryButton
          label={t('mentorHome.switchTalk')}
          variant="link"
          onPress={() => void switchToTalk()}
          loading={switching}
          testID="mentor-switch-talk"
        />
      </Entrance>
        </ScrollView>
      </SettleBack>
    </SafeAreaView>
  );
}

/** The console proper — mounted only once a listener token is on device, so the
 * data hook and heartbeat never spin up for a mentor who hasn't reached this state
 * yet. */
function ConsoleBody({
  animal,
  asksVersion,
  openAskId,
  onOpenAsk,
  onSessionLost,
}: {
  animal: CompanionAnimal | null;
  asksVersion: number;
  openAskId?: string;
  onOpenAsk: (ask: StayInTouchAsk, seats: number) => void;
  onSessionLost: () => void;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const c = useMentorConsole(t('mentor.atCapacity'));
  useListenerHeartbeat(c.me?.status === 'online');

  // Detect a server-side sweep to Away (the 15-minute heartbeat timeout) versus a
  // status change this device itself just requested — only the former shows the
  // "you were swept away" caption. `toggles` counts every local tap; `acknowledgedToggles`
  // is that count as of the last `c.me` this effect processed. A tap bumps `toggles`
  // immediately (synchronously, before the async status call resolves), so if the
  // `me` update this effect is reacting to was caused by that tap, the counts differ
  // and the sweep flag is skipped — a deliberate "Take a break" never shows swept.
  const prevStatus = useRef<'online' | 'away' | 'offline' | null>(null);
  const toggles = useRef(0);
  const acknowledgedToggles = useRef(0);
  const [swept, setSwept] = useState(false);

  useEffect(() => {
    if (!c.me) return;
    const sweptAway =
      prevStatus.current === 'online' &&
      c.me.status === 'away' &&
      toggles.current === acknowledgedToggles.current;
    if (sweptAway) setSwept(true);
    acknowledgedToggles.current = toggles.current;
    prevStatus.current = c.me.status;
  }, [c.me]);

  useEffect(() => {
    if (c.error === 'session') onSessionLost();
  }, [c.error, onSessionLost]);

  useEffect(() => {
    void registerPush('listener');
  }, []);

  // Waiting stay-in-touch asks (no push for these: "they will see it next time they are
  // here"). Refetched on focus and after every answer.
  const [asks, setAsks] = useState<StayInTouchAsk[]>([]);
  const openedFromParam = useRef<string | null>(null);
  const loadAsks = useCallback(() => {
    void listenerApi
      .stayInTouchAsks()
      .then(setAsks)
      .catch(() => {});
  }, []);
  useFocusEffect(loadAsks);
  useEffect(loadAsks, [asksVersion, loadAsks]);
  useEffect(() => {
    if (!openAskId || !c.me || openedFromParam.current === openAskId) return;
    const hit = asks.find((a) => a.id === openAskId);
    if (hit) {
      openedFromParam.current = openAskId;
      onOpenAsk(hit, c.me.max_concurrent);
    }
  }, [openAskId, asks, c.me, onOpenAsk]);

  const handleToggle = () => {
    toggles.current += 1;
    setSwept(false);
    void c.toggleStatus();
  };

  const openConversation = (conversation: {
    id: string;
    stream_channel_id: string | null;
    user_persona_name: string;
    member_masked: boolean;
  }) => {
    router.push({
      pathname: '/mentor/chat/[id]',
      params: {
        id: conversation.id,
        channel: conversation.stream_channel_id ?? '',
        member: conversation.user_persona_name,
        masked: conversation.member_masked ? '1' : '0',
      },
    });
  };

  if (c.loading && !c.me) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!c.me) {
    return (
      <Entrance index={1}>
        <EdgeSurface
          edge={colors.edgeSurface}
          style={[styles.card, { backgroundColor: colors.surface }]}
          testID="mentor-console-error"
        >
          <Text style={[type.body, { color: colors.ink }]}>{t('mentor.loadError')}</Text>
        </EdgeSurface>
        <PrimaryButton
          label={t('mentor.consoleRetry')}
          variant="ghost"
          onPress={() => void c.refresh()}
          testID="mentor-console-error-retry"
        />
      </Entrance>
    );
  }

  const active = c.conversations.filter((conv) => conv.status === 'active');
  const ended = c.conversations.filter((conv) => conv.status !== 'active');
  const conversations = [...active, ...ended];

  return (
    <View style={styles.console}>
      <PresenceHeader me={c.me} animal={animal} busy={c.busy === 'status'} swept={swept} onToggle={handleToggle} />

      {asks.length ? (
        <Entrance index={2} style={styles.list}>
          {asks.map((ask) => (
            <StayInTouchRow
              key={ask.id}
              id={ask.id}
              name={ask.member_persona_name}
              onPress={() => {
                if (c.me) onOpenAsk(ask, c.me.max_concurrent);
              }}
            />
          ))}
        </Entrance>
      ) : null}

      <Entrance index={3} style={styles.section}>
        <Text style={[styles.h2, { color: colors.ink }]} accessibilityRole="header">
          {t('mentor.requestsTitle')}
        </Text>
        {c.note ? (
          <Text style={[type.caption, styles.pad, { color: colors.warning }]} testID="mentor-note">
            {c.note}
          </Text>
        ) : null}
        {c.requests.length ? (
          c.requests.map((request) => (
            <RequestCard
              key={request.id}
              request={request}
              busy={c.busy === request.id}
              onAccept={() => void c.act(request.id, 'accept')}
              onDecline={() => void c.act(request.id, 'decline')}
            />
          ))
        ) : (
          <Text style={[type.caption, styles.pad, { color: colors.inkMuted }]} testID="mentor-requests-empty">
            {t('mentor.requestsEmpty')}
          </Text>
        )}
      </Entrance>

      <Entrance index={4} style={styles.section}>
        <Text style={[styles.h2, { color: colors.ink }]} accessibilityRole="header">
          {t('mentor.conversationsTitle')}
        </Text>
        {conversations.length ? (
          conversations.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              live={conversation.stream_channel_id ? c.live[conversation.stream_channel_id] : undefined}
              onPress={() => openConversation(conversation)}
            />
          ))
        ) : (
          <Text style={[type.caption, styles.pad, { color: colors.inkMuted }]} testID="mentor-convos-empty">
            {t('mentor.conversationsEmpty')}
          </Text>
        )}
      </Entrance>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.md },
  contentWide: { paddingHorizontal: space.lg },
  console: { gap: 12 },
  list: { gap: 12 },
  section: { gap: space.sm, paddingTop: space.xs },
  h2: { fontSize: 18, lineHeight: 24, fontFamily: type.label.fontFamily, paddingHorizontal: space.sm },
  pad: { paddingHorizontal: space.sm },
  grow: { flexGrow: 1, minHeight: space.md },
  foot: { alignItems: 'center' },
  centerText: { textAlign: 'center' },
  hero: { alignItems: 'center', gap: space.xs, marginTop: space.lg, marginBottom: space.xl },
  title: { ...type.displayHeadline, textAlign: 'center' },
  center: { alignItems: 'center', paddingVertical: space.xl },
  card: { borderRadius: radius.lg, padding: space.md, gap: space.xs, marginBottom: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  intro: { marginBottom: space.md },
  unavailable: { marginTop: space.xs },
  note: { marginBottom: space.sm },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EdgeSurface } from '@/components/EdgeSurface';
import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Companion } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { ConversationRow, isSnoozed } from '@/components/mentor/ConversationRow';
import { ownLive } from '@/lib/ownLive';
import { HomeStats } from '@/components/mentor/HomeStats';
import { MentorTabBar, type MentorTab } from '@/components/mentor/MentorTabBar';
import { OldestWaiting } from '@/components/mentor/OldestWaiting';
import { RequestFocus } from '@/components/mentor/RequestFocus';
import { RequestTotals, UpNext } from '@/components/mentor/RequestQueueExtras';
import { PresenceHeader } from '@/components/mentor/PresenceHeader';
import { CertifiedBadge } from '@/components/CertifiedBadge';
import { StayInTouchRow } from '@/components/mentor/StayInTouchRow';
import { LineSheet } from '@/components/mentor/LineSheet';
import { StayInTouchSheet } from '@/components/mentor/StayInTouchSheet';
import { SettleBack } from '@/components/motion/SettleBack';
import { Entrance } from '@/components/motion/Entrance';
import { Tilt3D } from '@/components/motion/Tilt3D';
import { api, type ListenerApplication } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { useI18n, type TKey } from '@/lib/i18n';
import { usePreparedAnswers } from '@/lib/preparedAnswers';
import { listenerApi, type ListenerMe, type StayInTouchAsk } from '@/lib/listenerApi';
import { getListenerToken, saveListenerToken } from '@/lib/listenerSession';
import { continueAsMember, loadApplication as readApplication } from '@/lib/mentorPath';
import { getCompanionAnimal, getPersona, type Persona } from '@/lib/session';
import { registerPush } from '@/lib/pushNotifications';
import { useMentorConsole } from '@/lib/useMentorConsole';
import { useListenerHeartbeat } from '@/lib/useListenerHeartbeat';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/** Mentor Home (DECISIONS §K.7): the mentor side — the native console itself (spec
 * 2026-09-05) — for an APPROVED mentor only. Outside the tab shell. Anyone who reaches it
 * without approval (a returning role-fork mentor from the landing, an old link, a
 * notification) is handed to the ONE mentor path (lib/mentorPath.ts, `/listener-apply`),
 * which shows the story, the application or where it stands (DECISIONS §L.12). "I'd rather
 * talk today" continues the member sign-up with only the missing steps (`continueAsMember`). */
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
  // The bottom bar (Requests, Conversations, Home, Profile): plain state, so this one route and every
  // push tap or old link to it stay as they are. The count is the number of waiting requests.
  const [tab, setTab] = useState<MentorTab>('home');
  const [requestCount, setRequestCount] = useState(0);
  const [switching, setSwitching] = useState(false);
  // Board A15: the stay-in-touch decision sheet over a settled-back Mentor Home.
  const [sheet, setSheet] = useState<{ ask: StayInTouchAsk; seats: number } | null>(null);
  const [asksVersion, setAsksVersion] = useState(0);
  // "Your line" — the same sheet pattern, over the same settled-back Mentor Home.
  const [lineMe, setLineMe] = useState<ListenerMe | null>(null);
  const [lineVersion, setLineVersion] = useState(0);
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
      const app = await readApplication();
      setLoadError(false);
      if (app?.status !== 'approved') {
        // Not the mentor side yet: the one mentor path takes over (story / application /
        // where it stands). Replace — this screen must not stay behind it.
        router.replace('/listener-apply');
        return;
      }
      setApplication(app);
      await ensureConsole();
    } catch {
      // Leave `application` as-is (no spinner flash, no accidental form reveal —
      // an unknown status must never show the form, that risks a duplicate apply).
      setLoadError(true);
    }
  }, [ensureConsole, router]);

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
      // The member sign-up continues with ONLY what the account is missing (founder ruling,
      // 2026-09-19): no companion yet → the companion pick on this same session, then Ready
      // → My Chats; nothing missing → straight to My Chats (dismissTo, never a second tabs).
      await continueAsMember(router);
    } catch {
      // Stay still and silent (T&S: no shaking/buzzing at a struggling user) —
      // release the spinner so the button is tappable again.
      setSwitching(false);
    }
  };

  const showConsole = application?.status === 'approved' && consoleReady === true;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={showConsole ? ['top'] : ['top', 'bottom']}>
      <SettleBack
        open={!!sheet || !!lineMe}
        onDismiss={() => {
          setSheet(null);
          setLineMe(null);
        }}
        dismissLabel={lineMe ? t('common.cancel') : t('mentorInTouch.later')}
        sheetLabel={lineMe ? t('mentor.line.title') : t('mentorInTouch.sheetA11y')}
        sheet={
          lineMe ? (
            <LineSheet
              me={lineMe}
              onClose={() => setLineMe(null)}
              onSaved={() => {
                setLineMe(null);
                setLineVersion((n) => n + 1);
              }}
            />
          ) : sheet ? (
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
      ) : !application ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : application.status === 'approved' ? (
        consoleReady === true ? (
          <ConsoleBody
            animal={animal}
            asksVersion={asksVersion}
            lineVersion={lineVersion}
            onOpenLine={setLineMe}
            tab={tab}
            onTab={setTab}
            onRequestCount={setRequestCount}
            onSwitchTalk={() => void switchToTalk()}
            switching={switching}
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
      ) : null}

      <View style={styles.grow} />
      {showConsole && tab !== 'home' ? null : (
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
      )}
        </ScrollView>
      </SettleBack>
      {showConsole ? <MentorTabBar tab={tab} onChange={setTab} requestCount={requestCount} /> : null}
    </SafeAreaView>
  );
}

/** The console proper — mounted only once a listener token is on device, so the
 * data hook and heartbeat never spin up for a mentor who hasn't reached this state
 * yet. */
function ConsoleBody({
  animal,
  asksVersion,
  lineVersion,
  onOpenLine,
  openAskId,
  onOpenAsk,
  onSessionLost,
  tab,
  onTab,
  onRequestCount,
  onSwitchTalk,
  switching,
}: {
  animal: CompanionAnimal | null;
  asksVersion: number;
  /** Bumped after "Your line" saves — the console re-reads `me`. */
  lineVersion: number;
  onOpenLine: (me: ListenerMe) => void;
  openAskId?: string;
  onOpenAsk: (ask: StayInTouchAsk, seats: number) => void;
  onSessionLost: () => void;
  tab: MentorTab;
  onTab: (tab: MentorTab) => void;
  onRequestCount: (n: number) => void;
  onSwitchTalk: () => void;
  switching: boolean;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const c = useMentorConsole(t('mentor.atCapacity'), t('mentor.requestTaken'));
  useListenerHeartbeat(c.me?.status === 'online');
  const prepared = usePreparedAnswers();
  const [chatTab, setChatTab] = useState<'active' | 'waiting' | 'touch'>('active');
  const [reqIndex, setReqIndex] = useState(0);

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

  // The bar's count: how many requests are waiting.
  const waiting = c.requests.length;
  useEffect(() => {
    onRequestCount(waiting);
  }, [waiting, onRequestCount]);

  useEffect(() => {
    if (c.error === 'session') onSessionLost();
  }, [c.error, onSessionLost]);

  useEffect(() => {
    void registerPush('listener');
  }, []);

  // Waiting stay-in-touch asks (no push for these: "they will see it next time they are
  // here"). Refetched on focus and after every answer.
  const [asks, setAsks] = useState<StayInTouchAsk[]>([]);
  // The conversation whose snooze / undo just failed — one still line, never a shake.
  const [snoozeFailed, setSnoozeFailed] = useState<string | null>(null);
  const openedFromParam = useRef<string | null>(null);
  const loadAsks = useCallback(() => {
    void listenerApi
      .stayInTouchAsks()
      .then(setAsks)
      .catch(() => {});
  }, []);
  useFocusEffect(loadAsks);
  useEffect(loadAsks, [asksVersion, loadAsks]);
  // "Your line" saved: re-read `me` so the row shows the new line (skips the first render).
  const refreshConsole = c.refresh;
  useEffect(() => {
    if (lineVersion > 0) void refreshConsole();
  }, [lineVersion, refreshConsole]);
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

  // Chats (founder choice, 2026-11-08): Active, Waiting on you and In touch. "Ended" is gone: a finished
  // chat stays only while the member and mentor stay in touch.
  const liveOf = (conv: (typeof c.conversations)[number]) =>
    conv.stream_channel_id ? c.live[conv.stream_channel_id] : ownLive(conv);
  const openChats = c.conversations.filter((conv) => conv.status === 'active');
  const isWaiting = (conv: (typeof c.conversations)[number]) => Boolean(liveOf(conv)?.waitingSince) && !isSnoozed(conv);
  const waitingChats = openChats.filter(isWaiting);
  const activeChats = [...openChats.filter((conv) => !isWaiting(conv) && !isSnoozed(conv)), ...openChats.filter((conv) => !isWaiting(conv) && isSnoozed(conv))];
  const touchChats = c.conversations.filter((conv) => conv.in_touch);
  const shownChats = chatTab === 'waiting' ? waitingChats : chatTab === 'touch' ? touchChats : activeChats;
  const weekAgo = Date.now() - 7 * 86_400_000;
  const weekCount = c.conversations.filter((conv) => Date.parse(conv.created_at) >= weekAgo).length;
  const seatsFree = Math.max(0, c.me.max_concurrent - c.me.active_conversations);
  const reqIdx = Math.min(reqIndex, Math.max(0, c.requests.length - 1));
  const request = c.requests[reqIdx];

  const setSnooze = async (id: string, on: boolean) => {
    setSnoozeFailed(null);
    if (!(await c.setSnooze(id, on))) setSnoozeFailed(id);
  };

  const chatRow = (conversation: (typeof c.conversations)[number]) => (
    <ConversationRow
      key={conversation.id}
      conversation={conversation}
      live={liveOf(conversation)}
      onPress={() => openConversation(conversation)}
      onSnooze={(on) => void setSnooze(conversation.id, on)}
      snoozeBusy={c.busy === `snooze:${conversation.id}`}
    />
  );

  return (
    <View style={styles.console}>
      {tab === 'home' ? (
        <>
          <PresenceHeader
            me={c.me}
            animal={animal}
            busy={c.busy === 'status'}
            swept={swept}
            onToggle={handleToggle}
            onOpenLine={() => c.me && onOpenLine(c.me)}
            afterGreeting={<HomeStats weekCount={weekCount} reply={c.me.reply_within} seatsFree={seatsFree} />}
          />

          {c.requests[0] ? (
            <Entrance index={3}>
              <OldestWaiting
                request={c.requests[0]}
                total={c.requests.length}
                busy={c.busy === c.requests[0].id}
                onAccept={() => void c.act(c.requests[0].id, 'accept')}
                onSeeAll={() => onTab('requests')}
              />
            </Entrance>
          ) : null}

          {asks.length ? (
            <Entrance index={4} style={styles.list}>
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
        </>
      ) : null}

      {tab === 'requests' ? (
        <Entrance index={1} style={styles.section}>
          <View style={styles.titleRow}>
            <Text style={[styles.display, { color: colors.ink }]} accessibilityRole="header">
              {t('mentor.requestsTitle')}
            </Text>
            {c.requests.length ? (
              <View style={[styles.countChip, { borderColor: colors.border, backgroundColor: colors.surface }]}>
                <Text style={[type.caption, { color: colors.inkMuted, fontFamily: type.label.fontFamily }]}>
                  {t('mentor.reqOf', { n: reqIdx + 1, total: c.requests.length })}
                </Text>
              </View>
            ) : null}
          </View>
          {c.note ? (
            <Text style={[type.caption, styles.pad, { color: colors.warning }]} testID="mentor-note">
              {c.note}
            </Text>
          ) : null}
          <RequestTotals requests={c.requests} replyWithin={c.me?.reply_within} />
          {request ? (
            <RequestFocus
              key={request.id}
              request={request}
              busy={c.busy === request.id}
              onAccept={() => void c.act(request.id, 'accept')}
              onDecline={() => void c.act(request.id, 'decline')}
              onNext={() => setReqIndex(reqIdx + 1 >= c.requests.length ? 0 : reqIdx + 1)}
              canNext={c.requests.length > 1}
            />
          ) : (
            <EmptyNote
              title={t('mentorHomePage.requestsEmptyTitle')}
              body={t('mentor.requestsEmpty')}
              testID="mentor-requests-empty"
            />
          )}
          <UpNext requests={c.requests} current={reqIdx} onPick={setReqIndex} />
        </Entrance>
      ) : null}

      {tab === 'chats' ? (
        <Entrance index={1} style={styles.section}>
          <Text style={[styles.display, { color: colors.ink }]} accessibilityRole="header">
            {t('mentor.chatsLead')} <Text style={{ color: colors.accent }}>{t('mentor.chatsAccent')}</Text>
          </Text>
          <View style={[styles.seg, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} accessibilityRole="tablist">
            {(
              [
                ['active', t('mentor.tabActive'), activeChats.length],
                ['waiting', t('mentor.tabWaiting'), waitingChats.length],
                ['touch', t('mentor.tabTouch'), touchChats.length],
              ] as const
            ).map(([key, label, count]) => {
              const on = chatTab === key;
              return (
                <Pressable
                  key={key}
                  onPress={() => setChatTab(key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: on }}
                  style={[styles.segItem, on && { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}
                  testID={`mentor-chats-${key}`}
                >
                  <Text style={[type.label, { color: on ? colors.accent : colors.inkMuted }]} numberOfLines={1}>
                    {label} · {count}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {snoozeFailed ? (
            <Text style={[type.caption, styles.pad, { color: colors.inkMuted }]} testID="mentor-snooze-error">
              {t('mentorHomePage.snoozeError')}
            </Text>
          ) : null}

          {chatTab === 'touch' && asks.length ? (
            <View style={styles.list}>
              <Text style={[type.label, styles.pad, { color: colors.inkMuted }]}>{t('mentor.touchAsks')}</Text>
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
            </View>
          ) : null}

          {shownChats.length ? (
            <View style={styles.list}>{shownChats.map(chatRow)}</View>
          ) : (
            <EmptyNote
              title={t(chatTab === 'touch' ? 'mentor.emptyTouch' : chatTab === 'waiting' ? 'mentor.emptyWaiting' : 'mentor.emptyActive')}
              body={t(chatTab === 'touch' ? 'mentor.touchNone' : chatTab === 'waiting' ? 'mentor.waitingNone' : 'mentor.activeNone')}
              testID="mentor-convos-empty"
            />
          )}
          {chatTab === 'touch' ? (
            <Text style={[type.caption, styles.centerText, { color: colors.inkMuted }]}>{t('mentor.touchFoot')}</Text>
          ) : null}
        </Entrance>
      ) : null}

      {tab === 'profile' ? (
        <Entrance index={1} style={styles.section}>
          <EdgeSurface edge={colors.edgeSurface} style={[styles.profile, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="mentor-profile">
            <Companion animal={(c.me.companion_animal as CompanionAnimal | undefined) ?? animal} size={84} awake />
            <Text style={[styles.display, { color: colors.ink, fontSize: 26, lineHeight: 34 }]}>{c.me.persona_name}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentorHomePage.rotationLine')}</Text>
            {c.me.certified ? <CertifiedBadge testID="mentor-profile-certified" /> : null}
          </EdgeSurface>

          <Pressable onPress={() => c.me && onOpenLine(c.me)} accessibilityRole="button" testID="mentor-profile-line">
            <EdgeSurface edge={colors.edgeSurface} style={[styles.lineCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[type.caption, styles.eyebrow, { color: colors.inkMuted }]}>{t('mentor.line.title')}</Text>
              <Text style={[type.body, { color: colors.ink }]}>{c.me.public_line ? `"${c.me.public_line}"` : t('mentor.profileLineAdd')}</Text>
            </EdgeSurface>
          </Pressable>

          <ProfileRow
            icon="document-text-outline"
            tone="orange"
            title={t('mentor.profileAnswers')}
            sub={t('mentor.profileAnswersSub', { count: prepared.answers.length })}
            onPress={() => router.push('/mentor/answers')}
            testID="mentor-profile-answers"
          />
          <ProfileRow
            icon="people-outline"
            tone="sky"
            title={t('mentor.profileTouch')}
            sub={t('mentor.profileTouchSub', { count: touchChats.length })}
            onPress={() => {
              setChatTab('touch');
              onTab('chats');
            }}
            testID="mentor-profile-touch"
          />
          <ProfileRow
            icon="book-outline"
            tone="green"
            title={t('mentor.profileReading')}
            sub={t('mentorHomePage.readingTitle')}
            onPress={() => router.push('/mentor/reading')}
            testID="mentor-profile-reading"
          />
          <ProfileRow
            icon="contrast-outline"
            tone="indigo"
            title={t('appearance.row')}
            sub={t('appearance.rowSub')}
            onPress={() => router.push('/appearance')}
            testID="mentor-profile-appearance"
          />
          <ProfileRow
            icon="shield-checkmark-outline"
            tone="indigo"
            title={t('mentor.profileHelp')}
            sub={t('mentor.profileHelpSub')}
            onPress={() => router.push('/mentor/helplines')}
            testID="mentor-profile-help"
          />
          <PrimaryButton label={t('mentorHome.switchTalk')} variant="link" onPress={onSwitchTalk} loading={switching} testID="mentor-profile-switch" />
        </Entrance>
      ) : null}
    </View>
  );
}

/** One row of the mentor Profile (founder choice, 2026-11-08): a round badge, a title with a quiet line under it, a chevron. */
function ProfileRow({
  icon,
  tone,
  title,
  sub,
  onPress,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'orange' | 'sky' | 'green' | 'indigo';
  title: string;
  sub: string;
  onPress: () => void;
  testID: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}. ${sub}`} testID={testID}>
      <EdgeSurface edge={colors.edgeSurface} style={[styles.profileRow, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <IconBadge icon={icon} tone={tone} size={40} />
        <View style={styles.rowText}>
          <Text style={[type.label, { color: colors.ink }]}>{title}</Text>
          <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={1}>
            {sub}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
      </EdgeSurface>
    </Pressable>
  );
}

/** A section with nothing in it yet (board A10's calm console): a still, dashed card that
 * holds the section's place, rather than a stray caption under the heading. */
function EmptyNote({ title, body, testID }: { title: string; body: string; testID: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.empty, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
      testID={testID}
    >
      <Text style={[type.bodySemi, { color: colors.ink }]}>{title}</Text>
      <Text style={[type.caption, { color: colors.inkMuted }]}>{body}</Text>
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
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  display: { fontSize: 30, lineHeight: 40, fontFamily: type.displaySerif.fontFamily, paddingHorizontal: space.sm },
  countChip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 4 },
  seg: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: radius.pill, borderWidth: 1 },
  segItem: { flex: 1, minHeight: 42, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderWidth: 1, borderColor: 'transparent' },
  profile: { alignItems: 'center', gap: space.xs, padding: space.md, borderWidth: 1 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1 },
  lineCard: { padding: 14, gap: 4, borderWidth: 1 },
  eyebrow: { textTransform: 'uppercase', letterSpacing: 0.6 },
  rowText: { flex: 1, minWidth: 0 },
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
  empty: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 2,
  },
});

/** Native own transport: existing persona/safety furniture, authenticated controller,
 * in-memory drafts only. Mounted solely by the authoritative native provider gate.
 */
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/PrimaryButton';
import { CompanionPerches, CompanionSlot, useCompanionPlacement } from '@/components/art/PerchedCompanion';
import { Bubble } from '@/components/chat/Bubble';
import { AllowanceNote } from '@/components/chat/AllowanceNote';
import { AllowanceRow } from '@/components/chat/AllowanceRow';
import { ChatHeaderCard } from '@/components/chat/ChatHeaderCard';
import { ComposerChromeContext, ComposerField, ComposerPerchContext } from '@/components/chat/ComposerField';
import { COMPOSER_SEAT, companionRoom } from '@/components/chat/companionRoom';
import { ConversationOptions } from '@/components/chat/ConversationOptions';
import { CrisisCard, type CrisisPayload } from '@/components/chat/CrisisCard';
import { ThreadEmpty } from '@/components/chat/ThreadEmpty';
import { ThreadRow, type ThreadMsg } from '@/components/chat/ThreadRow';
import { HelplinesSheet } from '@/components/mentor/HelplinesSheet';
import { MentorChatHeader } from '@/components/mentor/MentorChatHeader';
import { MentorComposerHint } from '@/components/mentor/MentorComposerHint';
import { MentorOptionsMenu } from '@/components/mentor/MentorOptionsMenu';
import { useSheetDepth } from '@/components/motion/useSheetDepth';
import { captureFirstMessage } from '@/lib/analytics';
import { clearAcknowledgedDraft } from '@/lib/acknowledgedDraft';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { leaveToChats, leaveToMentorHome } from '@/lib/leaveToChats';
import { listenerApi, type MemberBrief } from '@/lib/listenerApi';
import { createNativeOwnChatLifecycle } from '@/lib/nativeOwnChatLifecycle';
import { createAuthenticatedOwnChat } from '@/lib/ownChatApi';
import { OwnChatSendError } from '@/lib/ownChatAdapter';
import type { OwnChatSnapshot } from '@/lib/ownChatClient';
import { createOwnChatScreenController, type OwnScreenMessage } from '@/lib/ownChatScreenController';
import { pendingOption } from '@/lib/pendingOption';
import { CRISIS_EXEMPT_MS, useAllowance, type HeldAllowance } from '@/lib/useAllowance';
import { useChatHeader } from '@/lib/useChatHeader';
import { useChatKeyboardBoundary } from '@/lib/useChatKeyboardBoundary';
import { useListenerHeartbeat } from '@/lib/useListenerHeartbeat';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

type Controller = ReturnType<typeof createOwnChatScreenController>;
type Lifecycle = ReturnType<typeof createNativeOwnChatLifecycle>;

function MemberSessionGuard() { useSessionGuard(); return null; }

export function OwnNativeChatScreen({ role, conversationId, onRetry }: {
  role: 'member' | 'mentor'; conversationId: string; onRetry: () => void;
}) {
  const member = role === 'member';
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ listener?: string; member?: string; starter?: string; masked?: string }>();
  const header = useChatHeader(member ? conversationId : undefined);
  const [brief, setBrief] = useState<MemberBrief | null>(null);
  const name = member ? header.profile?.persona_name ?? params.listener ?? t('chat.yourListener') :
    brief?.persona_name ?? params.member ?? t('mentorChatPage.member');
  const [rows, setRows] = useState<OwnScreenMessage[]>([]);
  const [snapshot, setSnapshot] = useState<OwnChatSnapshot | null>(null);
  const [actor, setActor] = useState('');
  const [draft, setDraft] = useState(member ? params.starter ?? '' : '');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [error, setError] = useState(false);
  const [crisis, setCrisis] = useState<CrisisPayload | null>(null);
  const [crisisAt, setCrisisAt] = useState(0);
  const [options, setOptions] = useState(false);
  const [initialOption, setInitialOption] = useState<'report' | undefined>();
  const [menu, setMenu] = useState<'closed' | 'open' | 'confirmEnd'>('closed');
  const [ending, setEnding] = useState(false);
  const [helplines, setHelplines] = useState(false);
  const [saveOpen, setSaveOpen] = useState<string | null>(null);
  const [savedNow, setSavedNow] = useState<Set<string>>(new Set());
  const [offset, setOffset] = useState(0);
  const [mentorOnline, setMentorOnline] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [isForeground, setIsForeground] = useState(AppState.currentState === 'active');
  useListenerHeartbeat(!member && mentorOnline && isFocused && isForeground);
  const keyboardBoundary = useChatKeyboardBoundary(offset);
  const allowanceView = useAllowance(member ? conversationId : undefined,
    crisisAt > 0 && Date.now() - crisisAt < CRISIS_EXEMPT_MS);
  const allowanceRef = useRef(allowanceView);
  allowanceRef.current = allowanceView;
  const depth = useSheetDepth(options);
  const controller = useRef<Controller | null>(null);
  const lifecycle = useRef<Lifecycle | null>(null);
  const focused = useRef(false);
  const foreground = useRef(AppState.currentState === 'active');
  const shown = useRef(new Set<string>());
  const firstSent = useRef(false);
  const list = useRef<FlatList<OwnScreenMessage>>(null);

  useFocusEffect(useCallback(() => {
    focused.current = true; setIsFocused(true); lifecycle.current?.setFocused(true);
    if (member && pendingOption.take(conversationId) === 'report') {
      setInitialOption('report'); setOptions(true);
    }
    return () => { focused.current = false; setIsFocused(false); lifecycle.current?.setFocused(false); };
  }, [conversationId, member]));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      foreground.current = state === 'active';
      setIsForeground(foreground.current);
      lifecycle.current?.setForeground(foreground.current);
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    let live = true;
    let lastStatus: OwnChatSnapshot['status'] = 'idle';
    let lastAfter = 0;
    void (async () => {
      try {
        const identity = member ? await api.me() : await listenerApi.me();
        if (!member) {
          const currentBrief = await listenerApi.brief(conversationId);
          if (currentBrief.chat_backend !== 'own') throw new Error('owner_changed');
          if (live) setBrief(currentBrief);
        } else if ((await api.conversationState(conversationId)).chat_backend !== 'own') {
          throw new Error('owner_changed');
        }
        if (!live) return;
        if (!member) setMentorOnline('status' in identity && identity.status === 'online');
        setActor(identity.id);
        const scope = { actorId: identity.id, role, conversationId };
        const binding = createOwnChatScreenController(scope,
          onChange => createAuthenticatedOwnChat(scope, { transport: 'own', ownAccepted: true }, onChange),
          (state, messages) => {
            if (!live) return;
            lastStatus = state.status;
            setSnapshot(state); setRows(messages);
            if (state.status === 'terminal') {
              setDraft(''); setCrisis(null); setSending(false); setSaveOpen(null);
            }
            for (const message of messages) if (message.crisis && !shown.current.has(message.id)) {
              shown.current.add(message.id); setCrisis(message.crisis);
              setCrisisAt(previous => Math.max(previous, new Date(message.created_at).getTime()));
            }
            if (state.status === 'ready' && lifecycle.current?.readable()) binding.markRead();
            if (member && state.after !== lastAfter) {
              lastAfter = state.after; void allowanceRef.current.refresh();
            }
          });
        controller.current = binding;
        lifecycle.current = createNativeOwnChatLifecycle(binding, () => lastStatus !== 'terminal',
          { focused: focused.current, foreground: foreground.current });
      } catch { if (live) setError(true); }
    })();
    return () => {
      live = false; lifecycle.current?.dispose(); controller.current?.dispose();
      lifecycle.current = null; controller.current = null;
    };
  }, [conversationId, member, role]);

  const leave = () => member ? leaveToChats(router) : leaveToMentorHome(router);
  const closed = snapshot?.status === 'terminal';
  const retryable = error || snapshot?.reason === 'not_authorized' || snapshot?.reason === 'reconnect_exhausted';
  const connectionFailed = error || closed || snapshot?.reason === 'reconnect_exhausted';
  const ready = snapshot?.status === 'ready';
  const saved = new Set([...header.savedMessageIds, ...savedNow]);
  const latest = rows.at(-1);
  const lastMine = [...rows].reverse().find(row => row.user.id === actor)?.id;
  const perch = useCompanionPlacement('chat', [{ id: 'composerTop', type: 'top', level: 'low', home: true }], {
    hidden: !member || !!crisis || error || !!closed || sendError || options,
    still: !!allowanceView.note,
  });
  const threadFoot = member ? companionRoom(perch, !!allowanceView.note) : 0;

  async function send() {
    if (!draft.trim() || sending || !ready || !controller.current) return;
    const submitted = draft;
    setSending(true); setSendError(false);
    try {
      const result = await controller.current.sendMessage({ text: submitted });
      setDraft(current => clearAcknowledgedDraft(current, submitted));
      if (member && !firstSent.current) { firstSent.current = true; captureFirstMessage(result.message); }
    } catch (failure) {
      if (failure instanceof OwnChatSendError && failure.allowance && member) {
        await allowanceRef.current.applyHeld(failure.allowance as HeldAllowance);
      } else setSendError(true);
    } finally { setSending(false); }
  }
  async function save(message: ThreadMsg) {
    if (!member || saved.has(message.id)) return;
    try {
      await api.saveMentorNote({ body: message.text, conversation_id: conversationId,
        listener_persona: name, stream_message_id: message.id });
      setSavedNow(previous => new Set(previous).add(message.id)); header.refreshSaved();
    } catch { setSendError(true); }
  }
  async function end() {
    if (ending) return;
    setEnding(true);
    try { await listenerApi.end(conversationId); leave(); }
    catch { setEnding(false); setMenu('closed'); setSendError(true); }
  }
  const chrome = member ? {
    held: !!allowanceView.note,
    above: allowanceView.note && allowanceView.allowance ?
      <AllowanceNote allowance={allowanceView.allowance} reason={allowanceView.note} name={name}
        onJournal={() => router.dismissTo('/journals')} /> : allowanceView.allowance ?
      <AllowanceRow allowance={allowanceView.allowance} exempt={allowanceView.exempt} /> : null,
  } : {};

  return <SafeAreaView edges={['top', 'bottom']} style={[styles.safe, { backgroundColor: colors.bg }]}>
    {member ? <MemberSessionGuard /> : null}
    <CompanionPerches placement={perch}>
    {member ? <ChatHeaderCard conversationId={conversationId} name={name} face={header.face ?? undefined}
      status={header.profile?.status ?? null} replyWithinADay={!!header.profile?.reply_within_a_day}
      community={header.community} topic={header.topic} savedCount={header.savedCount} onBack={leave}
      onOpenProfile={() => router.push({ pathname: '/mentor-profile/[id]', params: { id: conversationId, name } })}
      onOpenOptions={() => setOptions(true)} /> : <MentorChatHeader memberName={name} brief={brief}
      here={!!snapshot?.peerOnline} masked={params.masked === '1' || !!brief?.member_masked} onBack={leave}
      onOpenBrief={() => router.push({ pathname: '/mentor/member/[id]', params: { id: conversationId, member: name } })}
      onOptions={() => setMenu('open')} onHelplines={() => setHelplines(true)} />}
    {connectionFailed ? <View style={styles.center}>
      <Text style={[type.body, { color: colors.ink }]}>{t(snapshot?.reason === 'ended' ||
        snapshot?.reason === 'wiped' ? 'reflection.ended' : 'chat.errOpen')}</Text>
      {retryable ? <PrimaryButton label={t('common.retry')} onPress={onRetry} testID="own-native-retry" /> : null}
    </View> : <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.flex, keyboardBoundary]} onLayout={event => event.currentTarget.measureInWindow((_x, y) => setOffset(y))}
      testID={ready ? 'own-native-chat-ready' : 'own-native-chat-connecting'}>
      <FlatList ref={list} data={rows} keyExtractor={item => item.id} style={styles.flex}
        contentContainerStyle={[styles.thread, { paddingBottom: space.md + threadFoot }]} keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={ready ? <ThreadEmpty /> : <ActivityIndicator color={colors.accent} />}
        ListFooterComponent={crisis ? <CrisisCard crisis={crisis} mentorName={name}
          audience={member ? 'member' : 'mentor'} inset={false} onDismiss={() => setCrisis(null)} /> : null}
        renderItem={({ item }) => member ? <ThreadRow item={{ id: item.id, text: item.text,
          mine: item.user.id === actor, at: item.created_at }} dayText={null} statusText={item.id === lastMine ?
            controller.current?.isRead(item.id) ? t('allowance.read') : t('allowance.delivered') : null}
          arrival={null} arrivalStep={0} saveOpen={member && (saveOpen === item.id ||
            latest?.id === item.id && item.user.id !== actor)} nudge={member && latest?.id === item.id}
          isSaved={member && saved.has(item.id)} savedNow={savedNow.has(item.id)}
          onToggleSave={id => { if (member) setSaveOpen(previous => previous === id ? null : id); }}
          onSave={message => void save(message)} onArrived={() => {}} /> :
          <View style={{ alignItems: item.user.id === actor ? 'flex-end' : 'flex-start' }}>
            <Bubble mine={item.user.id === actor} text={item.text} testID={`own-native-message-${item.id}`} />
            {item.id === lastMine ? <Text style={[type.caption, { color: colors.inkMuted }]}>
              {controller.current?.isRead(item.id) ? t('mentorChatPage.read') : t('allowance.delivered')}
            </Text> : null}
          </View>}
      />
      {snapshot?.peerTyping && !crisis ? <Text style={[type.caption, styles.typing, { color: colors.inkMuted }]}
        testID="own-native-typing">{t('chat.typing', { name })}</Text> : null}
      {!member ? <MentorComposerHint /> : null}
      {sendError ? <Text style={[type.caption, styles.typing, { color: colors.danger }]}>{t('chat.sendFailed')}</Text> : null}
      <ComposerChromeContext.Provider value={chrome}>
        <ComposerPerchContext.Provider value={member && !allowanceView.note ?
          <CompanionSlot id="composerTop" size={COMPOSER_SEAT.size} inset={space.lg} /> : null}>
        <ComposerField value={draft} onChangeText={value => { setDraft(value); controller.current?.typing(); }}
          onSubmit={() => void send()} disabled={!draft.trim() || sending || !ready} sending={sending}
          placeholder={member ? t('chat.placeholder') : t('mentorChatPage.placeholder', { name })}
          testIDPrefix={member ? 'own-native-composer' : 'own-native-mentor-composer'} autoFocus={!!params.starter} />
        </ComposerPerchContext.Provider>
      </ComposerChromeContext.Provider>
    </KeyboardAvoidingView>}
    {member ? <ConversationOptions conversationId={conversationId} visible={options} depth={depth}
      listenerName={name} initial={initialOption} onClose={() => { setOptions(false); setInitialOption(undefined); }}
      onLeft={leave} onSaveToJournal={() => setSaveOpen([...rows].reverse().find(row =>
        row.user.id !== actor && !saved.has(row.id))?.id ?? null)} /> : null}
    {!member && menu !== 'closed' ? <MentorOptionsMenu state={menu} top={96} ending={ending}
      onReport={() => { setMenu('closed'); router.push({ pathname: '/mentor/report', params: { id: conversationId } }); }}
      onAskEnd={() => setMenu('confirmEnd')} onConfirmEnd={() => void end()} onClose={() => setMenu('closed')} /> : null}
    {helplines ? <View style={styles.helplines}><HelplinesSheet onClose={() => setHelplines(false)} /></View> : null}
    </CompanionPerches>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, flex: { flex: 1 },
  center: { flex: 1, padding: space.lg, justifyContent: 'center', gap: space.md },
  thread: { padding: space.md, gap: space.sm }, typing: { paddingHorizontal: space.md, paddingVertical: space.sm },
  helplines: { position: 'absolute', top: 140, left: space.md, right: space.md, zIndex: 10 },
});

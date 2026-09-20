/**
 * First-question builder (DECISIONS §L.8, board A27) — reached from a Path starter, or
 * from "Ask a mentor" on the Path home (then the path's first starter is the headline).
 * The chosen starter is the headline; two OPTIONAL chip groups each add a short clause;
 * a live preview shows the assembled message in the member's accent.
 *
 * NEVER auto-sends (SCOPE §15). Both actions hand the assembled TEXT to the chat through
 * the existing `?starter=` contract, which only pre-fills the composer — the member
 * presses Send themselves:
 *   - "Take it to a mentor": match → chat, message waiting in the composer;
 *   - "Edit in chat": the same, plus `edit=1`, which opens the chat with the composer
 *     focused (caret at the end) so they can keep writing straight away.
 *
 * Honest subset of the board: the "uses 1 of your 3 messages in a row" meter is not
 * here — the message allowance (§L.2) is not built, so there is nothing true to show.
 * Sentence assembly, chip rules and the 160 limit live in lib/questionBuilder.ts (pure,
 * unit-tested: `npm run test:question`).
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BusyExits } from '@/components/BusyExits';
import { EdgeSurface } from '@/components/EdgeSurface';
import { OpenQuestionNote } from '@/components/OpenQuestionNote';
import { Companion } from '@/components/art/Companion';
import { DeepArrival } from '@/components/motion/DeepArrival';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { ApiError, api, type PathState } from '@/lib/api';
import { openNewChat } from '@/lib/askLoop';
import { useI18n, type TKey } from '@/lib/i18n';
import { openQuestionFrom, type OpenQuestion } from '@/lib/openQuestion';
import {
  EMPTY_CHOICE,
  QUESTION_MAX_CHARS,
  assembleQuestion,
  chipsFor,
  chosenChips,
  isChipOn,
  toggleChip,
  type BuilderChoice,
  type ChipId,
} from '@/lib/questionBuilder';
import { useCompanionAnimal } from '@/lib/useCompanionAnimal';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { leaveToPath } from '@/lib/leaveToChats';
import { breathe, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

const CHIP_LABEL: Record<ChipId, TKey> = {
  first: 'pathQuestion.chips.first',
  second: 'pathQuestion.chips.second',
  third: 'pathQuestion.chips.third',
  working: 'pathQuestion.chips.working',
  break: 'pathQuestion.chips.break',
  prep: 'pathQuestion.chips.prep',
  none: 'pathQuestion.chips.none',
};
const CHIP_CLAUSE: Record<ChipId, TKey> = {
  first: 'pathQuestion.clauses.first',
  second: 'pathQuestion.clauses.second',
  third: 'pathQuestion.clauses.third',
  working: 'pathQuestion.clauses.working',
  break: 'pathQuestion.clauses.break',
  prep: 'pathQuestion.clauses.prep',
  none: 'pathQuestion.clauses.none',
};

const GUTTER = space.md + space.xs; // 20 — the board's side margin
const COMPANION = 60;
const COMPANION_TUCK = 30; // how much of the companion sits behind the preview panel
const CARET_DIM = 0.15;
const CARET_LIT = 0.9;

/** A soft caret at the end of the draft — "this is still yours to write". */
function PreviewCaret({ color }: { color: string }) {
  const reduced = useReducedMotion();
  const glow = useSharedValue(CARET_LIT);

  useEffect(() => {
    if (reduced) {
      cancelAnimation(glow);
      glow.value = CARET_LIT;
      return;
    }
    glow.value = withRepeat(
      withTiming(CARET_DIM, { duration: breathe.period / 2, easing: easing.breathe }),
      -1,
      true,
    );
    return () => cancelAnimation(glow);
  }, [reduced, glow]);

  const style = useAnimatedStyle(() => ({ opacity: glow.value }));
  return <Animated.View style={[styles.caret, { backgroundColor: color }, style]} />;
}

export default function PathQuestion() {
  useSessionGuard();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const animal = useCompanionAnimal();
  const params = useLocalSearchParams<{ starter?: string; community?: string; lens?: string }>();

  const [path, setPath] = useState<PathState | null>(null);
  const [pathLoaded, setPathLoaded] = useState(false);
  const [starter, setStarter] = useState<string>(params.starter ?? '');
  const [choice, setChoice] = useState<BuilderChoice>(EMPTY_CHOICE);
  const [busy, setBusy] = useState<'continue' | 'edit' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Nobody free (503) or one open question at a time (409 `question_open`): still states
  // with honest ways on — never a dead end.
  const [busyExit, setBusyExit] = useState(false);
  const [openQ, setOpenQ] = useState<OpenQuestion | null>(null);

  // The route params paint the first frame; the member's path fills in the rest (the
  // other starters for "Another", and the lens when the screen was opened without it).
  useEffect(() => {
    let active = true;
    void api
      .myPath()
      .then((s) => {
        if (active) setPath(s);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setPathLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const prompts = useMemo(() => path?.prompts ?? [], [path]);
  useEffect(() => {
    if (!pathLoaded || starter) return;
    // Opened without a starter (a stray deep link): take the path's first one, or
    // go back to the Path tab — there is nothing to build from.
    if (prompts.length > 0) setStarter(prompts[0]);
    else leaveToPath(router);
  }, [pathLoaded, starter, prompts, router]);

  const community = params.community ?? path?.community?.slug ?? null;
  const lens =
    params.lens ?? (path?.community && path.stage ? `${path.community.name} · ${path.stage.title}` : '');

  const offered = useMemo(() => chipsFor(community), [community]);
  const assembled = useMemo(
    () =>
      assembleQuestion(
        starter,
        chosenChips(choice, community).map((id) => t(CHIP_CLAUSE[id])),
        { joinList: t('pathQuestion.joinList'), joinLast: t('pathQuestion.joinLast'), stop: t('pathQuestion.stop') },
      ),
    [starter, choice, community, t],
  );

  const another = () => {
    if (prompts.length < 2) return;
    const at = prompts.indexOf(starter);
    setStarter(prompts[(at + 1) % prompts.length]);
  };

  const go = async (mode: 'continue' | 'edit') => {
    if (busy || !assembled.text) return;
    setBusy(mode);
    setNote(null);
    setBusyExit(false);
    setOpenQ(null);
    try {
      const match = await api.match({ kind: 'general' });
      // replace: the builder has done its job — back from the chat should not return
      // to a half-used form holding a message that may already be sent.
      router.replace({
        pathname: '/chat/[id]',
        params: {
          id: match.conversation_id,
          listener: match.listener_persona_name,
          channel: match.stream_channel_id ?? '',
          starter: assembled.text, // pre-fills the composer — never sent for them
          ...(mode === 'edit' ? { edit: '1' } : {}),
        },
      });
    } catch (e) {
      // Stays still: a calm line, the draft and the chips untouched.
      const open = openQuestionFrom(e);
      if (open) setOpenQ(open);
      else if (e instanceof ApiError && e.status === 503) setBusyExit(true);
      else setNote(t('path.connectError'));
      setBusy(null);
    }
  };

  // The headline's last word carries the accent (board X07b).
  const split = starter.match(/^(.*\s)(\S+?)([.?!।…]*)$/);
  const lead = split ? split[1] : '';
  const word = split ? split[2] : starter;
  const mark = split ? split[3] : '';

  const renderChip = (id: ChipId) => {
    const on = isChipOn(choice, id);
    return (
      <PressKey
        key={id}
        onPress={() => setChoice((c) => toggleChip(c, id))}
        edge={on ? colors.accentTintEdge : colors.edgeSurface}
        intent="select"
        radius={radius.pill}
        disabled={busy !== null}
        accessibilityLabel={t(CHIP_LABEL[id])}
        accessibilityState={{ selected: on }}
        testID={`pq-chip-${id}`}
        style={[
          styles.chip,
          on
            ? { backgroundColor: colors.accentTint, borderColor: colors.accent, borderWidth: 2, paddingHorizontal: 13 }
            : { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
      >
        <Text style={[styles.chipText, { color: on ? colors.accentEdge : colors.ink }]}>{t(CHIP_LABEL[id])}</Text>
      </PressKey>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* The back key is simply there; the titles come in from the side (board "arrDeep"). */}
      <View style={styles.top}>
        <PressKey
          onPress={() => router.back()}
          edge={colors.edgeSurface}
          intent="navigate"
          radius={radius.pill}
          accessibilityLabel={t('pathQuestion.backA11y')}
          testID="pq-back"
          style={[styles.roundKey, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </PressKey>
        <DeepArrival style={styles.topText}>
          {lens ? (
            <Text style={[styles.lens, { color: colors.inkMuted }]} numberOfLines={1} testID="pq-lens">
              {lens}
            </Text>
          ) : null}
          <Text style={[styles.topTitle, { color: colors.ink }]} numberOfLines={1}>
            {t('pathQuestion.title')}
          </Text>
        </DeepArrival>
      </View>

      <DeepArrival style={styles.body}>
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Entrance index={1} style={styles.starter}>
          <View style={styles.starterRow}>
            <Text style={[type.caption, styles.starterNote, { color: colors.inkMuted }]}>
              {t('pathQuestion.notScript')}
            </Text>
            {prompts.length > 1 ? (
              <PressKey
                onPress={another}
                edge={colors.edgeSurface}
                travel={3}
                intent="select"
                radius={radius.pill}
                disabled={busy !== null}
                accessibilityLabel={t('pathQuestion.anotherA11y')}
                testID="pq-another"
                style={[styles.anotherKey, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <Ionicons name="refresh" size={16} color={colors.inkMuted} />
                <Text style={[styles.anotherText, { color: colors.inkMuted }]}>{t('pathQuestion.another')}</Text>
              </PressKey>
            ) : null}
          </View>
          <Text style={[styles.headline, { color: colors.ink }]} accessibilityRole="header" testID="pq-headline">
            {lead}
            <Text style={{ color: colors.accent }}>{word}</Text>
            {mark}
          </Text>
        </Entrance>

        {offered.where.length > 0 ? (
          <Entrance index={2}>
            <View style={styles.groupHead}>
              <Text style={[styles.groupTitle, { color: colors.ink }]}>{t('pathQuestion.whereTitle')}</Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>{t('pathQuestion.whereHint')}</Text>
            </View>
            <View style={styles.chips} accessibilityLabel={t('pathQuestion.whereTitle')} testID="pq-group-where">
              {offered.where.map(renderChip)}
            </View>
          </Entrance>
        ) : null}

        <Entrance index={3}>
          <View style={styles.groupHead}>
            <Text style={[styles.groupTitle, { color: colors.ink }]}>{t('pathQuestion.triedTitle')}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{t('pathQuestion.triedHint')}</Text>
          </View>
          <View style={styles.chips} accessibilityLabel={t('pathQuestion.triedTitle')} testID="pq-group-tried">
            {offered.tried.map(renderChip)}
          </View>
        </Entrance>

        <View style={styles.spacer} />

        <Entrance index={4} style={styles.messageBlock}>
          <View style={styles.groupHead}>
            <Text style={[styles.groupTitle, { color: colors.ink }]}>{t('pathQuestion.messageTitle')}</Text>
            <Text style={[type.caption, { color: assembled.overLimit ? colors.warning : colors.inkMuted }]} testID="pq-count">
              {t('pathQuestion.count', { used: assembled.length, max: QUESTION_MAX_CHARS })}
            </Text>
          </View>
          <View>
            {/* The companion peeks over the draft (decor only — flow is untouched). */}
            <View style={styles.companion} pointerEvents="none">
              <Companion animal={animal ?? null} size={COMPANION} />
            </View>
            <View
              style={[styles.panel, { backgroundColor: colors.bgLavender, borderColor: colors.border }]}
              accessibilityLiveRegion="polite"
              accessibilityLabel={t('pathQuestion.previewA11y', { message: assembled.text })}
            >
              <EdgeSurface
                edge={colors.accentEdge}
                travel={3}
                radius={radius.lg}
                faceRadiusStyle={{ borderBottomRightRadius: radius.sm }}
                containerStyle={styles.bubbleBox}
                style={[styles.bubble, { backgroundColor: colors.accent }]}
              >
                {/* The caret is an inline view so it rides the END of the text, wherever
                    the last line breaks. */}
                <Text style={[type.body, { color: colors.onAccent }]} testID="pq-preview">
                  {assembled.text}
                  <PreviewCaret color={colors.onAccent} />
                </Text>
              </EdgeSurface>
            </View>
          </View>
        </Entrance>

        <Entrance index={5}>
          <View style={styles.promise}>
            <Ionicons name="lock-closed-outline" size={15} color={colors.inkMuted} style={styles.promiseIcon} />
            <Text style={[type.caption, styles.promiseText, { color: colors.inkMuted }]}>
              {t('pathQuestion.editable')}
            </Text>
          </View>
          {assembled.dropped > 0 ? (
            <Text style={[type.caption, styles.dropped, { color: colors.ink }]} testID="pq-dropped">
              {t('pathQuestion.dropped')}
            </Text>
          ) : null}
        </Entrance>
      </ScrollView>
      </DeepArrival>

      <View style={styles.footer}>
        {openQ ? (
          <View style={styles.footNote}>
            <OpenQuestionNote
              question={openQ}
              onClosed={() => {
                setOpenQ(null);
                setNote(t('askFlow.openClosed'));
              }}
              testID="pq-open"
            />
          </View>
        ) : busyExit ? (
          <View style={styles.footNote}>
            <BusyExits
              // The one ask loop (lib/askLoop.ts): the New chat sheet over My Chats →
              // Pick a mentor → Browse → a mentor → the question step, pre-filled with
              // what they wrote — never sent for them.
              onSendInstead={() => openNewChat(router, { question: assembled.text, busy: true })}
              onRetry={() => void go('continue')}
              retrying={busy !== null}
              testID="pq-busy"
            />
          </View>
        ) : null}
        {note ? (
          <Text style={[type.caption, styles.note, { color: colors.inkMuted }]} testID="pq-note">
            {note}
          </Text>
        ) : null}
        <Entrance index={6}>
          <View style={styles.actions}>
            <PressKey
              onPress={() => void go('edit')}
              edge={colors.edgeSurface}
              intent="navigate"
              radius={radius.md}
              disabled={busy !== null || !assembled.text}
              accessibilityLabel={t('pathQuestion.editA11y')}
              testID="pq-edit"
              containerStyle={styles.editBox}
              style={[styles.action, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              {busy === 'edit' ? (
                <ActivityIndicator size="small" color={colors.ink} />
              ) : (
                <Text style={[styles.editText, { color: colors.ink }]} numberOfLines={1}>
                  {t('pathQuestion.edit')}
                </Text>
              )}
            </PressKey>
            <PressKey
              onPress={() => void go('continue')}
              edge={colors.accentEdge}
              intent="commit"
              radius={radius.md}
              disabled={busy !== null || !assembled.text}
              accessibilityLabel={t('pathQuestion.continueA11y')}
              testID="pq-continue"
              containerStyle={styles.continueBox}
              style={[styles.action, styles.actionFilled, { backgroundColor: colors.accent }]}
            >
              {busy === 'continue' ? (
                <ActivityIndicator size="small" color={colors.onAccent} />
              ) : (
                <>
                  <Text style={[styles.continueText, { color: colors.onAccent }]} numberOfLines={1}>
                    {t('pathQuestion.continue')}
                  </Text>
                  <Ionicons name="arrow-forward" size={20} color={colors.onAccent} />
                </>
              )}
            </PressKey>
          </View>
        </Entrance>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm + 4,
    paddingHorizontal: GUTTER,
    paddingTop: space.xs,
    paddingBottom: space.xs,
    minHeight: 50,
  },
  roundKey: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  topText: { flex: 1, minWidth: 0 },
  lens: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  topTitle: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 24 },
  anotherKey: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderWidth: 1,
    flexShrink: 0,
  },
  starter: { gap: space.xs },
  starterRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 },
  starterNote: { flex: 1, minWidth: 0 },
  spacer: { flexGrow: 1 },
  promise: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  promiseIcon: { marginTop: 1 },
  promiseText: { flex: 1, minWidth: 0 },
  anotherText: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  body: { flex: 1 },
  bodyContent: { flexGrow: 1, paddingHorizontal: GUTTER, paddingTop: space.xs, paddingBottom: space.sm, gap: 10 },
  headline: { fontFamily: font.sansHeavy, fontSize: 24, lineHeight: 30 },
  groupHead: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, marginBottom: space.xs + 2 },
  groupTitle: { fontFamily: font.sansBold, fontSize: 14, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { height: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  chipText: { fontFamily: font.sansBold, fontSize: 14, lineHeight: 20 },
  messageBlock: { marginTop: space.xs },
  companion: { position: 'absolute', right: 18, top: -(COMPANION - COMPANION_TUCK), zIndex: 0 },
  panel: { zIndex: 1, borderWidth: 1, borderRadius: radius.lg, padding: space.sm + 4, alignItems: 'flex-end' },
  bubbleBox: { maxWidth: '100%' },
  bubble: { paddingHorizontal: space.sm + 6, paddingVertical: space.sm + 2 },
  caret: { width: 2, height: 18, borderRadius: 2, marginLeft: 3, transform: [{ translateY: 3 }] },
  dropped: { fontFamily: font.sansBold, marginTop: space.xs },
  footer: { paddingHorizontal: GUTTER, paddingTop: space.sm, paddingBottom: space.md },
  note: { textAlign: 'center', marginBottom: space.sm },
  footNote: { marginBottom: space.sm },
  actions: { flexDirection: 'row', gap: 12 },
  editBox: { flex: 1 },
  continueBox: { flex: 1.6 },
  action: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
    borderWidth: 1,
  },
  actionFilled: { borderWidth: 0 },
  editText: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 20, flexShrink: 1 },
  continueText: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 24, flexShrink: 1 },
});

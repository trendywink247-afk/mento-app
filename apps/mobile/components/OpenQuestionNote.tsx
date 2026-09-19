/**
 * "You have a question open with …" — what a member meets when they try a new ask while a
 * Personal question still waits (server 409 `question_open`, lib/openQuestion.ts). The
 * words are My Chats' own (`chatsList.newChatWaiting`, board A06's dashed state), and the
 * two honest ways on: see the question (the letter, board A04) or close it.
 *
 * A refusal is a STILL state (T&S #11): no arrival, no haptic, never red.
 */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import { MentorAvatar } from '@/components/art/MentorAvatar';
import { PressKey } from '@/components/motion/PressKey';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { OpenQuestion } from '@/lib/openQuestion';
import { requestLetter } from '@/lib/requestLetter';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/** Paints the letter from what the refusal named, then opens it (it re-reads the server). */
export function openLetter(router: ReturnType<typeof useRouter>, q: OpenQuestion): void {
  requestLetter.put({
    request: {
      id: q.requestId,
      status: 'pending',
      target_listener_id: q.listenerId || null,
      intro_message: null,
      conversation_id: null,
      created_at: new Date().toISOString(),
    },
    mentor: q.listenerId ? { id: q.listenerId, name: q.name, avatar: q.avatar } : null,
  });
  router.push({ pathname: '/request-sent/[id]', params: { id: q.requestId } });
}

export function OpenQuestionNote({
  question,
  onClosed,
  onSee,
  testID = 'open-question',
}: {
  question: OpenQuestion;
  /** The question is closed on the server: the host may offer its ask again. */
  onClosed: () => void;
  /** Hosts that must leave first (a sheet) take the navigation; default opens the letter. */
  onSee?: () => void;
  testID?: string;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const [closing, setClosing] = useState(false);
  const [failed, setFailed] = useState(false);

  const close = () => {
    if (closing) return;
    setClosing(true);
    setFailed(false);
    void api
      .withdrawRequest(question.requestId)
      .then(() => onClosed())
      .catch(() => setFailed(true))
      .finally(() => setClosing(false));
  };

  return (
    <EdgeSurface
      edge={colors.edgeAlt}
      travel={3}
      radius={radius.lg}
      style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
      testID={testID}
    >
      <View style={styles.row} accessible accessibilityLabel={t('askFlow.openA11y', { name: question.name })}>
        {question.avatar ? <MentorAvatar seed={question.avatar} size={40} /> : null}
        <Text style={[type.note, styles.text, { color: colors.ink }]} testID={`${testID}-text`}>
          {t('chatsList.newChatWaiting', { name: question.name })}
        </Text>
      </View>
      {failed ? (
        <Text style={[type.caption, { color: colors.inkMuted }]} testID={`${testID}-close-failed`}>
          {t('askFlow.openCloseFailed')}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <PrimaryButton
          label={t('askFlow.openSee')}
          variant="surface"
          shape="key"
          dense
          trailing="arrow"
          onPress={onSee ?? (() => openLetter(router, question))}
          testID={`${testID}-see`}
        />
        <PressKey
          onPress={close}
          edge="transparent"
          travel={2}
          haptic="none"
          disabled={closing}
          accessibilityLabel={t('askFlow.openClose')}
          testID={`${testID}-close`}
          containerStyle={styles.linkBox}
          style={styles.link}
        >
          <Text style={[styles.linkText, { color: colors.inkMuted }]}>{t('askFlow.openClose')}</Text>
        </PressKey>
      </View>
    </EdgeSurface>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 10, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, minWidth: 0 },
  actions: { gap: 2 },
  linkBox: { alignSelf: 'center' },
  link: { height: 44, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
  linkText: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 20, textDecorationLine: 'underline' },
});

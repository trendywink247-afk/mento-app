import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import { KeyboardAvoidingView } from '@/components/KeyboardAvoidingView';
import { MentorPageHeader } from '@/components/mentor/MentorPageHeader';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n, type TKey } from '@/lib/i18n';
import {
  BODY_MAX,
  cleanShortcut,
  newAnswerId,
  TITLE_MAX,
  usePreparedAnswers,
  validateAnswer,
  type AnswerProblem,
  type PreparedAnswer,
} from '@/lib/preparedAnswers';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

const PROBLEM: Record<Exclude<AnswerProblem, null>, TKey> = {
  shortcut: 'answers.errShortcut',
  title: 'answers.errTitle',
  body: 'answers.errBody',
  duplicate: 'answers.errDuplicate',
  full: 'answers.errFull',
};

/**
 * Prepared answers (founder, 2026-11-08): a mentor's own reusable replies, each with a /shortcut.
 * Kept on this phone only. In a chat, "/" and a few letters lists them and choosing one fills the box.
 */
export default function PreparedAnswers() {
  useSessionGuard();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const { answers, save, remove } = usePreparedAnswers();
  // null = the list; an answer (new or existing) = the form.
  const [editing, setEditing] = useState<PreparedAnswer | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [problem, setProblem] = useState<AnswerProblem>(null);

  const open = (a: PreparedAnswer | null) => {
    setProblem(null);
    setIsNew(!a);
    setEditing(a ?? { id: newAnswerId(), shortcut: '', title: '', body: '' });
  };

  const submit = async () => {
    if (!editing) return;
    const bad = validateAnswer(editing, answers, isNew ? undefined : editing.id);
    if (bad) {
      setProblem(bad);
      return;
    }
    await save({ ...editing, shortcut: cleanShortcut(editing.shortcut), title: editing.title.trim(), body: editing.body.trim() });
    setEditing(null);
  };

  const field = [styles.field, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.ink }];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.safe}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <MentorPageHeader
            eyebrow={t('answers.count', { count: answers.length })}
            title={editing ? t(isNew ? 'answers.new' : 'answers.edit') : t('answers.title')}
            onBack={() => (editing ? setEditing(null) : router.back())}
          />

          {editing ? (
            <View style={styles.form}>
              <Text style={[type.label, { color: colors.ink }]}>{t('answers.shortcut')}</Text>
              <TextInput
                value={editing.shortcut}
                onChangeText={(v) => setEditing({ ...editing, shortcut: v })}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={13}
                placeholder="thanks"
                placeholderTextColor={colors.inkMuted}
                accessibilityLabel={t('answers.shortcut')}
                style={field}
                testID="answer-shortcut"
              />
              <Text style={[type.caption, { color: colors.inkMuted }]}>{t('answers.shortcutHint')}</Text>
              <Text style={[type.label, { color: colors.ink }]}>{t('answers.titleLabel')}</Text>
              <TextInput
                value={editing.title}
                onChangeText={(v) => setEditing({ ...editing, title: v })}
                maxLength={TITLE_MAX}
                accessibilityLabel={t('answers.titleLabel')}
                style={field}
                testID="answer-title"
              />
              <Text style={[type.label, { color: colors.ink }]}>{t('answers.bodyLabel')}</Text>
              <TextInput
                value={editing.body}
                onChangeText={(v) => setEditing({ ...editing, body: v })}
                multiline
                maxLength={BODY_MAX}
                accessibilityLabel={t('answers.bodyLabel')}
                style={[field, styles.body]}
                testID="answer-body"
              />
              <Text style={[type.caption, { color: colors.inkMuted }]}>
                {editing.body.length} / {BODY_MAX}
              </Text>
              {problem ? (
                <Text style={[type.caption, { color: colors.danger }]} accessibilityLiveRegion="polite" testID="answer-problem">
                  {t(PROBLEM[problem])}
                </Text>
              ) : null}
              <PrimaryButton label={t('answers.save')} shape="key" onPress={() => void submit()} testID="answer-save" />
              {!isNew ? (
                <PrimaryButton
                  label={t('answers.delete')}
                  variant="link"
                  onPress={() => {
                    void remove(editing.id);
                    setEditing(null);
                  }}
                  testID="answer-delete"
                />
              ) : null}
            </View>
          ) : (
            <View style={styles.list}>
              <Text style={[type.body, { color: colors.inkMuted }]}>{t('answers.intro')}</Text>
              {answers.length === 0 ? (
                <View style={[styles.empty, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]} testID="answers-empty">
                  <Text style={[type.body, { color: colors.ink }]}>{t('answers.empty')}</Text>
                </View>
              ) : (
                [...answers]
                  .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.shortcut.localeCompare(b.shortcut))
                  .map((a) => (
                    <PressKey
                      key={a.id}
                      onPress={() => open(a)}
                      edge={colors.edgeSurface}
                      radius={radius.lg}
                      intent="navigate"
                      accessibilityLabel={`${a.title}. /${a.shortcut}`}
                      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
                      testID={`answer-${a.shortcut}`}
                    >
                      <View style={[styles.chip, { backgroundColor: colors.accentTint }]}>
                        <Text style={[type.caption, { color: colors.accentEdge, fontFamily: type.label.fontFamily }]}>/{a.shortcut}</Text>
                      </View>
                      <Text style={[type.label, { color: colors.ink }]}>{a.title}</Text>
                      <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={2}>
                        {a.body}
                      </Text>
                    </PressKey>
                  ))
              )}
              <PrimaryButton label={t('answers.new')} shape="key" onPress={() => open(null)} testID="answer-new" />
              <Text style={[type.caption, styles.note, { color: colors.inkMuted }]}>{t('answers.deviceOnly')}</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xl, gap: space.md },
  list: { gap: 12 },
  form: { gap: 8 },
  field: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, ...type.body, fontSize: 16 },
  body: { minHeight: 130, textAlignVertical: 'top' },
  card: { padding: 14, gap: 4, borderWidth: 1 },
  chip: { alignSelf: 'flex-start', borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 1 },
  empty: { borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', padding: 14 },
  note: { textAlign: 'center' },
});

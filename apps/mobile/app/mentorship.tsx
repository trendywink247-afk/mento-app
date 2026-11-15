import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DeepHeader } from '@/components/DeepHeader';
import { KeyboardAvoidingView } from '@/components/KeyboardAvoidingView';
import { OpenQuestionNote } from '@/components/OpenQuestionNote';
import { PrimaryButton } from '@/components/PrimaryButton';
import { PressKey } from '@/components/motion/PressKey';
import { ApiError, api, type ExamAttempt, type MarksVisibility, type MenteeProfile } from '@/lib/api';
import { useI18n, type TKey } from '@/lib/i18n';
import { LANGUAGES } from '@/lib/languages';
import { leaveToChats } from '@/lib/leaveToChats';
import { MARK_MAX, attemptsOk, isEmpty, markGroups, markOk, nextAttempt, parseMark, toPayload, type MarkField } from '@/lib/menteeForm';
import { openQuestionFrom, type OpenQuestion } from '@/lib/openQuestion';
import { askIntro, openAsked } from '@/lib/startChat';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/**
 * "Start mentorship" (DECISIONS R.5, R.6, R.14): the intake form, then the question goes to
 * Mentors and Mento Verified (`audience: "mentorship"`), never listeners. Every field is
 * optional and "Skip and send" sends no form at all. With `edit=1` (from Profile) it only
 * saves or clears. Example fields until the real form is supplied.
 *
 * Only the mentor who receives the request sees the form, never with a name; marks follow
 * the member's own choice of who may see them. The note is crisis-scanned by the server.
 */
type Choice<T extends string> = { key: T; label: TKey };

const STAGES: Choice<NonNullable<MenteeProfile['current_stage']>>[] = [
  { key: 'starting', label: 'intake.stage_starting' },
  { key: 'prelims_prep', label: 'intake.stage_prelims_prep' },
  { key: 'mains_prep', label: 'intake.stage_mains_prep' },
  { key: 'interview_prep', label: 'intake.stage_interview_prep' },
  { key: 'between_attempts', label: 'intake.stage_between_attempts' },
];
const FURTHEST: Choice<NonNullable<MenteeProfile['furthest_stage']>>[] = [
  { key: 'none', label: 'intake.furthest_none' },
  { key: 'prelims', label: 'intake.furthest_prelims' },
  { key: 'mains', label: 'intake.furthest_mains' },
  { key: 'interview', label: 'intake.furthest_interview' },
];
const PREP: Choice<NonNullable<MenteeProfile['prep_mode']>>[] = [
  { key: 'self', label: 'intake.prep_self' },
  { key: 'coaching', label: 'intake.prep_coaching' },
  { key: 'both', label: 'intake.prep_both' },
  { key: 'working', label: 'intake.prep_working' },
];
const HELP: Choice<string>[] = (
  ['strategy', 'answer_writing', 'optional', 'current_affairs', 'revision', 'motivation', 'interview', 'other'] as const
).map((k) => ({ key: k, label: `intake.help_${k}` as TKey }));
const REACHED: Choice<ExamAttempt['stage']>[] = [
  { key: 'prelims', label: 'intake.prelims' },
  { key: 'mains', label: 'intake.mains' },
  { key: 'interview', label: 'intake.interview' },
];
const VISIBILITY: Choice<MarksVisibility>[] = [
  { key: 'nobody', label: 'intake.vis_nobody' },
  { key: 'mentors', label: 'intake.vis_mentors' },
  { key: 'everyone', label: 'intake.vis_everyone' },
];

function Chips<T extends string>({
  options,
  value,
  onToggle,
  testID,
}: {
  options: { key: T; label: string; disabled?: boolean }[];
  value: T[];
  onToggle: (k: T) => void;
  testID: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = value.includes(o.key);
        return (
          <PressKey
            key={o.key}
            onPress={() => !o.disabled && onToggle(o.key)}
            // A "Coming soon" chip reads as unavailable: flat, dashed, muted ink (DECISIONS R.6).
            edge={o.disabled ? 'transparent' : on ? colors.accentTintEdge : colors.edgeSurface}
            travel={3}
            disabled={o.disabled}
            radius={radius.pill}
            intent="select"
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on, disabled: o.disabled }}
            testID={`${testID}-${o.key}`}
            style={[
              styles.chip,
              o.disabled
                ? { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderStyle: 'dashed' as const }
                : { backgroundColor: on ? colors.accentTint : colors.surface, borderColor: on ? colors.accent : colors.border },
            ]}
          >
            <Text style={[type.label, { color: o.disabled ? colors.inkMuted : on ? colors.accentInk : colors.ink }]}>{o.label}</Text>
          </PressKey>
        );
      })}
    </View>
  );
}

export default function Mentorship() {
  useSessionGuard();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const params = useLocalSearchParams<{ topic?: string; question?: string; edit?: string }>();
  const editing = params.edit === '1';
  const [form, setForm] = useState<MenteeProfile>({ marks_visibility: 'mentors', help_with: [], attempts: [] });
  // Typed mark text per attempt and field, so "88." can be typed on the way to "88.5".
  const [markText, setMarkText] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [support, setSupport] = useState<MenteeProfile['support']>(null);
  const [openQ, setOpenQ] = useState<OpenQuestion | null>(null);

  useEffect(() => {
    let live = true;
    void api
      .menteeProfile()
      .then((p) => {
        if (!live) return;
        setForm({ ...p, help_with: p.help_with ?? [], attempts: p.attempts ?? [], marks_visibility: p.marks_visibility ?? 'mentors' });
        const texts: Record<string, string> = {};
        (p.attempts ?? []).forEach((a, i) =>
          (Object.keys(MARK_MAX) as MarkField[]).forEach((f) => {
            if (a[f] != null) texts[`${i}:${f}`] = String(a[f]);
          }),
        );
        setMarkText(texts);
      })
      .catch(() => {
        /* reason: an empty form still works; saving will say if the network is down */
      })
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, []);

  const set = (patch: Partial<MenteeProfile>) => setForm((f) => ({ ...f, ...patch }));
  const one = <K extends keyof MenteeProfile>(k: K, v: MenteeProfile[K]) => set({ [k]: form[k] === v ? null : v } as Partial<MenteeProfile>);
  const attempts = form.attempts ?? [];
  const setAttempt = (i: number, patch: Partial<ExamAttempt>) =>
    set({ attempts: attempts.map((a, j) => (j === i ? { ...a, ...patch } : a)) });
  const removeAttempt = (i: number) => {
    set({ attempts: attempts.filter((_, j) => j !== i) });
    setMarkText({});
  };
  const typeMark = (i: number, f: MarkField, text: string) => {
    setMarkText((m) => ({ ...m, [`${i}:${f}`]: text }));
    const v = parseMark(text);
    setAttempt(i, { [f]: v === null ? null : v } as Partial<ExamAttempt>);
  };

  const back = () => (router.canGoBack() ? router.back() : leaveToChats(router));

  /** Saves the form (if any). Returns false when the member must look at something first. */
  const save = async (): Promise<boolean> => {
    if (!attemptsOk(attempts)) {
      setNote(t('intake.badMarks'));
      return false;
    }
    if (isEmpty(form)) return true;
    const saved = await api.saveMenteeProfile(toPayload(form));
    if (saved.support && !support) {
      // The note tripped the crisis scan: the helplines first; pressing again goes on.
      setSupport(saved.support);
      return false;
    }
    return true;
  };

  const send = async (withForm: boolean) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    setOpenQ(null);
    try {
      if (withForm && !(await save())) return;
      const request = await api.ask({
        issue_category: params.topic ?? null,
        intro_message: askIntro(params.question),
        audience: 'mentorship',
      });
      openAsked(router, request);
    } catch (e) {
      const open = openQuestionFrom(e);
      if (open) setOpenQ(open);
      else if (e instanceof ApiError && e.status === 422) setNote(t('intake.badMarks'));
      else setNote(e instanceof ApiError && e.status === 503 ? t('askFlow.busyBody') : t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const saveOnly = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      if (await save()) setNote(t('intake.saved'));
    } catch (e) {
      setNote(e instanceof ApiError && e.status === 422 ? t('intake.badMarks') : t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.clearMenteeProfile();
      setForm({ marks_visibility: 'mentors', help_with: [], attempts: [] });
      setMarkText({});
      setNote(t('intake.cleared'));
    } catch {
      setNote(t('common.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const label = (k: TKey) => <Text style={[type.label, styles.q, { color: colors.ink }]}>{t(k)}</Text>;
  const inputStyle = [styles.input, { color: colors.ink, backgroundColor: colors.surface, borderColor: colors.border }];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
        <DeepHeader title={t(editing ? 'intake.editTitle' : 'twoWays.mentorKey')} onBack={back} />
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" testID="intake-form">
            <Text style={[type.title, { color: colors.ink }]}>{t('intake.title')}</Text>
            <Text style={[type.bodySmall, { color: colors.inkMuted }]}>{t('intake.sub')}</Text>

            {label('intake.exam')}
            <Chips
              options={[
                { key: 'upsc', label: t('intake.upsc') },
                { key: 'other', label: t('intake.comingSoon'), disabled: true },
              ]}
              value={form.exam ? [form.exam] : []}
              onToggle={() => one('exam', 'upsc')}
              testID="intake-exam"
            />

            {label('intake.stage')}
            <Chips options={STAGES.map((c) => ({ key: c.key, label: t(c.label) }))} value={form.current_stage ? [form.current_stage] : []} onToggle={(k) => one('current_stage', k)} testID="intake-stage" />

            {label('intake.attemptsCount')}
            <Chips
              options={['0', '1', '2', '3', '4', '5', '6'].map((n) => ({ key: n, label: n === '6' ? '6+' : n }))}
              value={form.attempts_count != null ? [String(Math.min(form.attempts_count, 6))] : []}
              onToggle={(k) => set({ attempts_count: form.attempts_count === Number(k) ? null : Number(k) })}
              testID="intake-attempts"
            />

            {label('intake.furthest')}
            <Chips options={FURTHEST.map((c) => ({ key: c.key, label: t(c.label) }))} value={form.furthest_stage ? [form.furthest_stage] : []} onToggle={(k) => one('furthest_stage', k)} testID="intake-furthest" />

            {label('intake.optional')}
            <TextInput
              value={form.optional_subject ?? ''}
              onChangeText={(v) => set({ optional_subject: v.slice(0, 40) })}
              placeholder={t('intake.optionalPlaceholder')}
              placeholderTextColor={colors.inkMuted}
              maxLength={40}
              style={inputStyle}
              testID="intake-optional"
            />

            {label('intake.prep')}
            <Chips options={PREP.map((c) => ({ key: c.key, label: t(c.label) }))} value={form.prep_mode ? [form.prep_mode] : []} onToggle={(k) => one('prep_mode', k)} testID="intake-prep" />

            {label('intake.language')}
            <Chips options={LANGUAGES.slice(0, 8).map((l) => ({ key: l.code, label: l.name }))} value={form.language ? [form.language] : []} onToggle={(k) => one('language', k)} testID="intake-lang" />

            {label('intake.help')}
            <Chips
              options={HELP.map((c) => ({ key: c.key, label: t(c.label) }))}
              value={form.help_with ?? []}
              onToggle={(k) => {
                const cur = form.help_with ?? [];
                set({ help_with: cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k] });
              }}
              testID="intake-help"
            />

            {label('intake.marksTitle')}
            <Text style={[type.caption, { color: colors.inkMuted }]}>{t('intake.marksSub')}</Text>
            {attempts.map((a, i) => (
              <View key={i} style={[styles.attempt, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]} testID={`intake-attempt-${i}`}>
                <View style={styles.attemptHead}>
                  <Text style={[type.caption, { color: colors.inkMuted }]}>{t('intake.year')}</Text>
                  <TextInput
                    value={String(a.year)}
                    onChangeText={(v) => {
                      const y = Number(v.replace(/\D/g, '').slice(0, 4));
                      if (y) setAttempt(i, { year: y });
                    }}
                    keyboardType="number-pad"
                    maxLength={4}
                    style={[inputStyle, styles.year]}
                    testID={`intake-year-${i}`}
                  />
                  <View style={styles.grow} />
                  <PrimaryButton label={t('intake.removeAttempt')} variant="link" onPress={() => removeAttempt(i)} testID={`intake-remove-${i}`} />
                </View>
                <Text style={[type.caption, { color: colors.inkMuted }]}>{t('intake.reached')}</Text>
                <Chips options={REACHED.map((c) => ({ key: c.key, label: t(c.label) }))} value={[a.stage]} onToggle={(k) => setAttempt(i, { stage: k })} testID={`intake-reached-${i}`} />
                {markGroups(a.stage).map((g) => (
                  <View key={g.group} style={styles.markGroup}>
                    <Text style={[type.label, { color: colors.inkMuted }]} accessibilityRole="header">
                      {t(`intake.group_${g.group}` as TKey)}
                    </Text>
                    <View style={styles.marks}>
                      {g.fields.map((f) => {
                        const text = markText[`${i}:${f}`] ?? '';
                        const ok = markOk(f, parseMark(text));
                        return (
                          <View key={f} style={styles.mark}>
                            <Text style={[type.caption, { color: colors.ink }]} numberOfLines={1}>
                              {t(`intake.${f}` as TKey)}
                            </Text>
                            <TextInput
                              value={text}
                              onChangeText={(v) => typeMark(i, f, v)}
                              keyboardType="decimal-pad"
                              maxLength={6}
                              placeholder={t('intake.max', { max: String(MARK_MAX[f]) })}
                              placeholderTextColor={colors.inkMuted}
                              style={[inputStyle, !ok ? { borderColor: colors.danger ?? '#B3261E' } : null]}
                              accessibilityLabel={`${t(`intake.${f}` as TKey)}, ${t('intake.max', { max: String(MARK_MAX[f]) })}`}
                              testID={`intake-mark-${i}-${f}`}
                            />
                          </View>
                        );
                      })}
                    </View>
                  </View>
                ))}
              </View>
            ))}
            {attempts.length < 10 ? (
              <PrimaryButton label={t('intake.addAttempt')} variant="ghost" icon="add" onPress={() => set({ attempts: [...attempts, nextAttempt(attempts)] })} testID="intake-add-attempt" />
            ) : null}

            {label('intake.visibility')}
            <Chips options={VISIBILITY.map((c) => ({ key: c.key, label: t(c.label) }))} value={[form.marks_visibility ?? 'mentors']} onToggle={(k) => set({ marks_visibility: k })} testID="intake-vis" />

            {label('intake.note')}
            <TextInput
              value={form.note ?? ''}
              onChangeText={(v) => set({ note: v.slice(0, 200) })}
              placeholder={t('intake.notePlaceholder')}
              placeholderTextColor={colors.inkMuted}
              maxLength={200}
              multiline
              style={[inputStyle, styles.noteInput]}
              testID="intake-note"
            />
            <Text style={[type.micro, styles.count, { color: colors.inkMuted }]}>{`${(form.note ?? '').length}/200`}</Text>

            {support ? (
              <View style={[styles.support, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]} testID="intake-support">
                <Text style={[type.bodySmall, { color: colors.ink }]}>{support.message}</Text>
                {support.helplines.map((h) => (
                  <Text key={h.number} style={[type.label, { color: colors.ink }]}>{`${h.name}: ${h.number}`}</Text>
                ))}
              </View>
            ) : null}
            {openQ ? <OpenQuestionNote question={openQ} onClosed={() => setOpenQ(null)} testID="intake-open" /> : null}
            {note ? (
              <Text style={[type.note, styles.notice, { color: colors.ink, backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} testID="intake-note-text">
                {note}
              </Text>
            ) : null}

            <View style={styles.actions}>
              {editing ? (
                <>
                  <PrimaryButton label={t('intake.save')} onPress={() => void saveOnly()} loading={busy} testID="intake-save" />
                  <PrimaryButton label={t('intake.clear')} variant="link" onPress={() => void clear()} testID="intake-clear" />
                </>
              ) : (
                <>
                  <PrimaryButton label={t('intake.send')} onPress={() => void send(true)} loading={busy} trailing="arrow" testID="intake-send" />
                  <PrimaryButton label={t('intake.skip')} variant="link" onPress={() => void send(false)} testID="intake-skip" />
                </>
              )}
            </View>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.md, paddingBottom: 48, gap: space.sm },
  q: { paddingTop: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { minHeight: 40, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  input: { minHeight: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, fontFamily: font.sans, fontSize: 16 },
  noteInput: { minHeight: 88, paddingTop: 10, textAlignVertical: 'top' },
  count: { alignSelf: 'flex-end' },
  attempt: { borderWidth: 1, borderRadius: radius.lg, padding: space.sm + 4, gap: space.sm },
  attemptHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  year: { width: 76, textAlign: 'center' },
  grow: { flex: 1 },
  markGroup: { gap: 4 },
  marks: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -4 },
  mark: { width: '50%', paddingHorizontal: 4, paddingBottom: 8, gap: 2 },
  support: { borderWidth: 1, borderRadius: radius.md, padding: 12, gap: 4 },
  notice: { padding: 12, borderRadius: radius.md, borderWidth: 1 },
  actions: { paddingTop: space.md, gap: space.xs },
});

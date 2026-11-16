/**
 * The mentor's answer-evaluation queue (DECISIONS T.8). Mentors and Mento Verified see answers sent
 * to everyone, or to them by name; take one, read the photos, write feedback, return it. What it
 * would pay is shown as a record (nothing is paid until payments are approved). Nothing here says
 * who sent an answer.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthedPhoto } from '@/components/AuthedPhoto';
import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import { MentorPageHeader } from '@/components/mentor/MentorPageHeader';
import { ApiError } from '@/lib/api';
import { useI18n, type TKey } from '@/lib/i18n';
import { listenerApi, type MentorEvaluation } from '@/lib/listenerApi';
import { getListenerToken } from '@/lib/listenerSession';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

const MIN_FEEDBACK = 40;

const rupees = (paise: number) => `₹${Math.floor(paise / 100).toLocaleString('en-IN')}`;

export default function MentorEvaluations() {
  useSessionGuard();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const [state, setState] = useState<'loading' | 'off' | 'on'>('loading');
  const [items, setItems] = useState<MentorEvaluation[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await listenerApi.evaluations());
      setState('on');
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? 'off' : 'on');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, run: () => Promise<unknown>) => {
    setBusy(id);
    setMsg(null);
    try {
      await run();
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError && e.status !== 0 ? e.message : t('evaluate.error'));
      await load();
    } finally {
      setBusy(null);
    }
  };

  const waiting = items.filter((x) => x.status !== 'returned');
  const done = items.filter((x) => x.status === 'returned');

  const card = (ev: MentorEvaluation) => {
    const draft = drafts[ev.id] ?? '';
    return (
      <EdgeSurface key={ev.id} edge={colors.edgeSurface} style={[styles.item, { backgroundColor: colors.surface, borderColor: colors.border }]} testID={`mentor-evaluation-${ev.status}`}>
        <View style={styles.top}>
          <Text style={[type.label, { color: colors.ink, flex: 1 }]}>{t(`evaluate.kind_${ev.kind}` as TKey)}</Text>
          {ev.personal ? (
            <Text style={[type.caption, styles.chip, { color: colors.accentInk, backgroundColor: colors.accentTint }]}>{t('mentorEval.personal')}</Text>
          ) : null}
          <Text style={[type.caption, { color: colors.inkMuted }]}>{rupees(ev.payout_paise)}</Text>
        </View>
        {ev.question ? <Text style={[type.body, { color: colors.ink }]}>{ev.question}</Text> : null}
        {ev.note ? <Text style={[type.caption, { color: colors.inkMuted }]}>{ev.note}</Text> : null}
        {ev.pages_available && ev.pages ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
            {Array.from({ length: ev.pages }, (_, i) => (
              <AuthedPhoto
                key={i}
                url={listenerApi.evaluationPageUrl(ev.id, i)}
                getToken={getListenerToken}
                accessibilityLabel={t('evaluate.photoA11y', { n: i + 1 })}
                style={styles.photo}
              />
            ))}
          </ScrollView>
        ) : null}
        {ev.status === 'open' ? (
          <PrimaryButton label={t('mentorEval.take')} shape="key" loading={busy === ev.id} onPress={() => void act(ev.id, () => listenerApi.claimEvaluation(ev.id))} testID="mentor-evaluation-take" />
        ) : null}
        {ev.status === 'claimed' ? (
          <>
            {ev.due_at ? (
              <Text style={[type.caption, { color: colors.inkMuted }]}>
                {t('mentorEval.due', { when: new Date(ev.due_at).toLocaleString() })}
              </Text>
            ) : null}
            <TextInput
              value={draft}
              onChangeText={(v) => setDrafts((d) => ({ ...d, [ev.id]: v }))}
              maxLength={4000}
              multiline
              placeholder={t('mentorEval.feedbackPlaceholder')}
              placeholderTextColor={colors.inkMuted}
              accessibilityLabel={t('mentorEval.feedback')}
              testID="mentor-evaluation-feedback"
              style={[styles.input, { color: colors.ink, backgroundColor: colors.bg, borderColor: colors.border }]}
            />
            <PrimaryButton
              label={t('mentorEval.return')}
              shape="key"
              loading={busy === ev.id}
              disabled={draft.trim().length < MIN_FEEDBACK}
              onPress={() => void act(ev.id, () => listenerApi.returnEvaluation(ev.id, draft.trim()))}
              testID="mentor-evaluation-return"
            />
          </>
        ) : null}
        {ev.status === 'returned' && ev.feedback ? (
          <Text style={[type.body, { color: colors.inkMuted }]} numberOfLines={4}>{ev.feedback}</Text>
        ) : null}
      </EdgeSurface>
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <MentorPageHeader eyebrow={t('earnings.title')} title={t('mentorEval.title')} onBack={() => router.back()} />
        {state === 'off' ? (
          <Text style={[type.body, { color: colors.inkMuted }]} testID="mentor-evaluations-soon">{t('evaluate.soon')}</Text>
        ) : state === 'loading' ? null : (
          <>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentorEval.intro')}</Text>
            {msg ? <Text style={[type.caption, { color: colors.inkMuted }]} accessibilityLiveRegion="polite">{msg}</Text> : null}
            {waiting.length ? waiting.map(card) : (
              <View style={styles.empty}>
                <Ionicons name="checkmark-done-outline" size={22} color={colors.inkMuted} />
                <Text style={[type.body, { color: colors.inkMuted }]}>{t('mentorEval.empty')}</Text>
              </View>
            )}
            {done.length ? (
              <>
                <Text style={[type.label, { color: colors.ink, marginTop: space.md }]}>{t('mentorEval.returned')}</Text>
                {done.map(card)}
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { padding: space.md, gap: space.sm, paddingBottom: space.xl },
  item: { padding: space.md, gap: 8, borderWidth: 1, borderRadius: radius.lg },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  photos: { gap: space.sm, paddingVertical: 4 },
  photo: { width: 220, height: 300 },
  input: { minHeight: 120, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, textAlignVertical: 'top', ...type.body },
  empty: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.md },
});

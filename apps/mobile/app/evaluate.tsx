/**
 * Get an answer evaluated (DECISIONS T.8): photos of a written Mains answer or essay go to the
 * mentors (or one mentor chosen on Peers), and come back with written feedback. Behind the server's
 * `evaluations_enabled`; while it is off the list call answers 404 and this page says "soon".
 * Anonymous both ways: the mentor sees the photos and the words, never who sent them.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AuthedPhoto } from '@/components/AuthedPhoto';
import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { CrisisCard } from '@/components/chat/CrisisCard';
import { PressKey } from '@/components/motion/PressKey';
import { ApiError, api, currentMemberToken, type Evaluation } from '@/lib/api';
import { useI18n, type TKey } from '@/lib/i18n';
import { pickPhotos } from '@/lib/pickDocument';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

const MAX = { mains: 4, essay: 12 } as const;
type Kind = keyof typeof MAX;

export default function Evaluate() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  // Opened from a mentor's card on Peers: the answer goes to that mentor only.
  const params = useLocalSearchParams<{ listenerId?: string; name?: string }>();
  const toOne = typeof params.listenerId === 'string' && params.listenerId.length > 0;

  const [state, setState] = useState<'loading' | 'off' | 'on'>('loading');
  const [items, setItems] = useState<Evaluation[]>([]);
  const [kind, setKind] = useState<Kind>('mains');
  const [question, setQuestion] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [support, setSupport] = useState<Evaluation['support']>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api.evaluations());
      setState('on');
    } catch (e) {
      setState(e instanceof ApiError && e.status === 404 ? 'off' : 'on');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const choose = async () => {
    setMsg(null);
    const r = await pickPhotos(MAX[kind] - photos.length);
    if (r.ok) {
      setPhotos((p) => [...p, ...r.photos].slice(0, MAX[kind]));
      if (r.skipped) setMsg(t('evaluate.skipped', { count: r.skipped }));
    } else if (r.reason === 'unavailable') setMsg(t('verify.needsUpdate'));
    else if (r.reason === 'unreadable') setMsg(t('evaluate.unreadable'));
  };

  const send = async () => {
    if (!photos.length || busy) return;
    setBusy(true);
    setMsg(null);
    setSupport(null);
    try {
      const draft = await api.startEvaluation({
        kind,
        audience: toOne ? 'one' : 'everyone',
        ...(toOne ? { listener_id: params.listenerId } : {}),
        ...(question.trim() ? { question: question.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      for (const p of photos) await api.addEvaluationPage(draft.id, p);
      const sent = await api.sendEvaluation(draft.id);
      if (sent.support) setSupport(sent.support);
      setPhotos([]);
      setQuestion('');
      setNote('');
      setMsg(t('evaluate.sent'));
      await load();
    } catch (e) {
      setMsg(e instanceof ApiError && e.status !== 0 ? e.message : t('evaluate.error'));
    } finally {
      setBusy(false);
    }
  };

  const withdraw = async (id: string) => {
    try {
      await api.withdrawEvaluation(id);
      await load();
    } catch {
      setMsg(t('evaluate.error'));
    }
  };

  const inputStyle = [styles.input, { color: colors.ink, backgroundColor: colors.surface, borderColor: colors.border }];

  return (
    <Screen onBack={() => router.back()} scroll keyboardTaps="handled">
      <Text style={[type.title, { color: colors.ink }]} accessibilityRole="header">
        {t('evaluate.title')}
      </Text>
      {state === 'off' ? (
        <Text style={[type.body, { color: colors.inkMuted }]} testID="evaluate-soon">
          {t('evaluate.soon')}
        </Text>
      ) : state === 'loading' ? null : (
        <>
          <Text style={[type.body, { color: colors.inkMuted }]}>
            {toOne ? t('evaluate.introOne', { name: params.name ?? '' }) : t('evaluate.intro')}
          </Text>

          <View style={styles.kinds}>
            {(['mains', 'essay'] as Kind[]).map((k) => {
              const on = kind === k;
              return (
                <PressKey
                  key={k}
                  onPress={() => {
                    setKind(k);
                    setPhotos((p) => p.slice(0, MAX[k]));
                  }}
                  edge={on ? colors.accentTintEdge : colors.edgeSurface}
                  travel={3}
                  radius={radius.pill}
                  intent="select"
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  testID={`evaluate-kind-${k}`}
                  style={[styles.kind, { backgroundColor: on ? colors.accentTint : colors.surface, borderColor: on ? colors.accent : colors.border }]}
                >
                  <Text style={[type.label, { color: on ? colors.accentInk : colors.ink }]}>{t(`evaluate.kind_${k}` as TKey)}</Text>
                </PressKey>
              );
            })}
          </View>

          <TextInput
            value={question}
            onChangeText={setQuestion}
            maxLength={500}
            multiline
            placeholder={t('evaluate.questionPlaceholder')}
            placeholderTextColor={colors.inkMuted}
            accessibilityLabel={t('evaluate.question')}
            testID="evaluate-question"
            style={inputStyle}
          />
          <TextInput
            value={note}
            onChangeText={setNote}
            maxLength={500}
            multiline
            placeholder={t('evaluate.notePlaceholder')}
            placeholderTextColor={colors.inkMuted}
            accessibilityLabel={t('evaluate.note')}
            testID="evaluate-note"
            style={inputStyle}
          />

          <PrimaryButton
            label={photos.length ? t('evaluate.photosReady', { count: photos.length, max: MAX[kind] }) : t('evaluate.choose')}
            variant="surface"
            onPress={() => void choose()}
            disabled={busy || photos.length >= MAX[kind]}
            testID="evaluate-choose"
          />
          <Text style={[type.caption, { color: colors.inkMuted }]}>{t('evaluate.limits', { max: MAX[kind] })}</Text>
          <PrimaryButton
            label={busy ? t('evaluate.sending') : t('evaluate.send')}
            shape="key"
            onPress={() => void send()}
            loading={busy}
            disabled={!photos.length}
            testID="evaluate-send"
          />
          {msg ? (
            <Text style={[type.caption, { color: colors.inkMuted }]} accessibilityLiveRegion="polite" testID="evaluate-msg">
              {msg}
            </Text>
          ) : null}
          {support ? (
            <CrisisCard crisis={{ support: support.message, signal: '', helplines: support.helplines }} audience="request" inset={false} />
          ) : null}

          {items.length ? (
            <View style={styles.list}>
              <Text style={[type.label, { color: colors.ink }]}>{t('evaluate.yours')}</Text>
              {items.map((ev) => {
                const expanded = open === ev.id;
                return (
                  <EdgeSurface
                    key={ev.id}
                    edge={colors.edgeSurface}
                    style={[styles.item, { backgroundColor: colors.surface, borderColor: colors.border }]}
                    testID={`evaluation-${ev.status}`}
                  >
                    <PressKey onPress={() => setOpen(expanded ? null : ev.id)} edge={colors.surface} travel={2} radius={radius.md} intent="navigate" accessibilityLabel={t(`evaluate.kind_${ev.kind}` as TKey)} style={styles.itemTop}>
                      <Text style={[type.label, { color: colors.ink, flex: 1 }]} numberOfLines={expanded ? undefined : 1}>
                        {ev.question || t(`evaluate.kind_${ev.kind}` as TKey)}
                      </Text>
                      <Text style={[type.caption, styles.chip, { color: colors.accentInk, backgroundColor: colors.accentTint }]}>
                        {t(`evaluate.status_${ev.status}` as TKey)}
                      </Text>
                      <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.inkMuted} />
                    </PressKey>
                    {ev.mentor_name ? (
                      <Text style={[type.caption, { color: colors.inkMuted }]}>{t('evaluate.mentor', { name: ev.mentor_name })}</Text>
                    ) : null}
                    {ev.feedback ? <Text style={[type.body, { color: colors.ink }]} testID="evaluation-feedback">{ev.feedback}</Text> : null}
                    {expanded && ev.pages_available && ev.pages ? (
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photos}>
                        {Array.from({ length: ev.pages }, (_, i) => (
                          <AuthedPhoto
                            key={i}
                            url={api.evaluationPageUrl(ev.id, i)}
                            getToken={currentMemberToken}
                            accessibilityLabel={t('evaluate.photoA11y', { n: i + 1 })}
                            style={styles.photo}
                          />
                        ))}
                      </ScrollView>
                    ) : null}
                    {ev.status === 'open' || ev.status === 'claimed' ? (
                      <PrimaryButton label={t('evaluate.withdraw')} variant="link" onPress={() => void withdraw(ev.id)} testID="evaluation-withdraw" />
                    ) : null}
                  </EdgeSurface>
                );
              })}
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  kinds: { flexDirection: 'row', gap: space.sm },
  kind: { paddingHorizontal: 16, paddingVertical: 10, borderWidth: 1 },
  input: { minHeight: 56, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, textAlignVertical: 'top', ...type.body },
  list: { gap: space.sm, marginTop: space.md },
  item: { padding: space.md, gap: 6, borderWidth: 1, borderRadius: radius.lg },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' },
  photos: { gap: space.sm, paddingVertical: 4 },
  photo: { width: 220, height: 300 },
});

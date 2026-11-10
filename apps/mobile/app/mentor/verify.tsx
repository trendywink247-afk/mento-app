import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/PrimaryButton';
import { MentorPageHeader } from '@/components/mentor/MentorPageHeader';
import { PressKey } from '@/components/motion/PressKey';
import { ApiError } from '@/lib/api';
import { useI18n, type TKey } from '@/lib/i18n';
import { listenerApi, type DocumentKind, type ListenerMe, type VerificationDoc } from '@/lib/listenerApi';
import { pickDocument } from '@/lib/pickDocument';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type, wash, washInk } from '@/theme/tokens';

const KINDS: DocumentKind[] = ['id_card', 'posting_letter', 'result', 'other'];

/** Send one document to become Mento Verified. The team reads it and decides; the file is deleted at once. */
export default function MentorVerify() {
  useSessionGuard();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const [me, setMe] = useState<ListenerMe | null>(null);
  const [docs, setDocs] = useState<VerificationDoc[]>([]);
  const [kind, setKind] = useState<DocumentKind>('id_card');
  const [file, setFile] = useState<{ base64: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [m, d] = await Promise.all([listenerApi.me(), listenerApi.documents()]);
      setMe(m);
      setDocs(d);
    } catch {
      /* the page still draws; sending reports its own errors */
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const choose = async () => {
    setNote(null);
    const r = await pickDocument();
    if (r.ok) setFile({ base64: r.file.base64, name: r.file.name });
    else if (r.reason === 'unavailable') setNote(t('verify.needsUpdate'));
    else if (r.reason === 'too_big') setNote(t('verify.tooBig'));
    else if (r.reason === 'unreadable') setNote(t('verify.unreadable'));
  };

  const send = async () => {
    if (!file || busy) return;
    setBusy(true);
    setNote(null);
    try {
      await listenerApi.sendDocument({ kind, content_base64: file.base64 });
      setFile(null);
      setNote(t('verify.sent'));
      await load();
    } catch (e) {
      setNote(e instanceof ApiError && e.status !== 0 ? e.message : t('verify.error'));
    } finally {
      setBusy(false);
    }
  };

  const verified = Boolean(me?.certified);
  const pending = docs.some((d) => d.status === 'pending');
  const chip = (status: VerificationDoc['status']) =>
    status === 'approved' ? { bg: wash.green, ink: washInk.green } : status === 'rejected' ? { bg: wash.danger, ink: washInk.danger } : { bg: wash.orange, ink: washInk.orange };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <MentorPageHeader eyebrow={t('verify.eyebrow')} title={t('verify.title')} onBack={() => router.back()} />
        {verified ? (
          <View style={[styles.done, { backgroundColor: wash.green }]} testID="verify-done">
            <Ionicons name="checkmark-circle" size={24} color={washInk.green} />
            <Text style={[type.label, { color: washInk.green, flex: 1 }]}>{t('verify.alreadyVerified')}</Text>
          </View>
        ) : (
          <>
            <Text style={[type.body, { color: colors.inkMuted }]}>{t('verify.intro')}</Text>
            <Text style={[type.label, { color: colors.ink }]}>{t('verify.kind')}</Text>
            <View style={styles.kinds}>
              {KINDS.map((k) => {
                const on = kind === k;
                return (
                  <PressKey
                    key={k}
                    onPress={() => setKind(k)}
                    edge={on ? colors.accentTintEdge : colors.edgeSurface}
                    travel={3}
                    radius={radius.pill}
                    intent="select"
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    testID={`verify-kind-${k}`}
                    style={[styles.kind, { backgroundColor: on ? colors.accentTint : colors.surface, borderColor: on ? colors.accent : colors.border }]}
                  >
                    <Text style={[type.label, { color: on ? colors.accentInk : colors.ink }]}>{t(`verify.kind_${k}` as TKey)}</Text>
                  </PressKey>
                );
              })}
            </View>
            <PrimaryButton label={file ? t('verify.fileReady', { name: file.name }) : t('verify.choose')} variant="surface" onPress={() => void choose()} disabled={pending || busy} testID="verify-choose" />
            <Text style={[type.caption, { color: colors.inkMuted }]}>{t('verify.limits')}</Text>
            <PrimaryButton label={busy ? t('verify.sending') : t('verify.send')} shape="key" onPress={() => void send()} loading={busy} disabled={!file || pending} testID="verify-send" />
          </>
        )}
        {note ? (
          <Text style={[type.caption, { color: colors.inkMuted }]} accessibilityLiveRegion="polite" testID="verify-note">
            {note}
          </Text>
        ) : null}
        {docs.length ? (
          <View style={styles.list}>
            <Text style={[type.label, { color: colors.ink }]}>{t('verify.yours')}</Text>
            {docs.map((d) => {
              const c = chip(d.status);
              return (
                <View key={d.id} style={[styles.doc, { backgroundColor: colors.surface, borderColor: colors.border }]} testID={`verify-doc-${d.status}`}>
                  <View style={styles.docTop}>
                    <Text style={[type.label, { color: colors.ink, flex: 1 }]}>{t(`verify.kind_${d.kind}` as TKey)}</Text>
                    <View style={[styles.statusChip, { backgroundColor: c.bg }]}>
                      <Text style={[type.caption, { color: c.ink, fontFamily: type.label.fontFamily }]}>{t(`verify.status_${d.status}` as TKey)}</Text>
                    </View>
                  </View>
                  {d.note ? <Text style={[type.caption, { color: colors.inkMuted }]}>{d.note}</Text> : null}
                </View>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.xl, gap: space.md },
  done: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderRadius: radius.lg, padding: space.md },
  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  kind: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  list: { gap: space.sm, marginTop: space.sm },
  doc: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: 4 },
  docTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  statusChip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
});

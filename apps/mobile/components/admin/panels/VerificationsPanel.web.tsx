import { createElement, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import { EMPTY_COUNTS, ExamCountsFields } from '@/components/admin/ExamCountsFields.web';
import { ConsolePressable } from '@/components/console/ConsolePressable';
import { ApiError } from '@/lib/api';
import { adminApi, type AdminVerification } from '@/lib/adminApi';
import { canBeMentor, grantForDocument, parseCounts, TIER_LABEL, type ExamCountsText } from '@/lib/adminTiers';
import { formatTimestamp } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

const KIND: Record<string, string> = { id_card: 'ID card', posting_letter: 'Posting letter', mains_admit_card: 'Mains admission card', interview_letter: 'Interview letter', result: 'Exam result', other: 'Something else' };

/**
 * Documents (founder, 2026-11-10; tiers per DECISIONS R.4, option b, 2026-11-15): the mentors who
 * sent a document, oldest first. The team reads it here and approves it as proof for a tier: an
 * in-service document (ID card, posting letter) makes Mento Verified, an exam document (Mains
 * admission card, interview letter, result) makes a Mentor with the exam history read off it. The
 * admin can switch the grant. Or says no, with a short reason the mentor sees. The file is deleted
 * the moment a decision is made. Every read of a file is written to the audit log.
 */
export default function VerificationsPanel() {
  const { colors } = useTheme();
  const [items, setItems] = useState<AdminVerification[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [url, setUrl] = useState<{ id: string; href: string; type: string } | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  // Per document: the tier the approval grants (default from its kind) and the counts for a Mentor.
  const [grant, setGrant] = useState<Record<string, 'mentor' | 'verified'>>({});
  const [counts, setCounts] = useState<Record<string, ExamCountsText>>({});
  const grantOf = (d: AdminVerification) => grant[d.id] ?? grantForDocument(d.kind);
  const countsOf = (d: AdminVerification) => counts[d.id] ?? EMPTY_COUNTS;

  const load = async () => {
    try {
      setItems(await adminApi.listVerifications('pending'));
      setError(null);
    } catch {
      setError('Could not load documents. Retry shortly.');
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url.href);
    },
    [url],
  );

  const view = async (d: AdminVerification) => {
    setOpenId(d.id);
    setError(null);
    try {
      setUrl({ id: d.id, href: await adminApi.verificationFileUrl(d.id), type: d.content_type });
    } catch {
      setError('Could not open that file.');
    }
  };

  const decide = async (d: AdminVerification, approve: boolean) => {
    setBusy(d.id);
    setError(null);
    try {
      if (approve)
        await adminApi.approveVerification(
          d.id,
          grantOf(d) === 'mentor' ? { grant: 'mentor', ...parseCounts(countsOf(d)) } : { grant: 'verified' },
        );
      else await adminApi.rejectVerification(d.id, reason.trim() || null);
      setUrl(null);
      setOpenId(null);
      setRejecting(null);
      setReason('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save that decision. Retry shortly.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.wrap} testID="admin-verifications">
      <Text style={[type.title, { color: colors.ink }]}>Documents to verify</Text>
      <Text style={[type.caption, { color: colors.inkMuted }]}>
        Approve a document as proof for a tier: in-service proof makes Mento Verified, exam proof makes a Mentor
        (enter what it shows). The file is deleted when you decide. Reading a file is recorded.
      </Text>
      {error ? <Text style={[type.caption, { color: colors.danger }]}>{error}</Text> : null}
      {items === null ? (
        <ActivityIndicator color={colors.accent} />
      ) : items.length === 0 ? (
        <Text style={[type.body, { color: colors.inkMuted }]} testID="admin-verifications-empty">Nothing waiting.</Text>
      ) : (
        items.map((d) => (
          <View key={d.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]} testID={`admin-verification-${d.id}`}>
            <Text style={[type.label, { color: colors.ink }]}>
              {d.persona_name} · {KIND[d.kind] ?? d.kind}
            </Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              Sent {formatTimestamp(d.created_at)} · {Math.max(1, Math.round(d.size_bytes / 1024))} KB
            </Text>
            {openId === d.id && url?.id === d.id ? (
              url.type === 'application/pdf' ? (
                createElement('iframe', { src: url.href, title: 'Document', style: { width: '100%', height: 520, border: 0, borderRadius: 12 } })
              ) : (
                createElement('img', { src: url.href, alt: 'Document', style: { maxWidth: '100%', maxHeight: 560, objectFit: 'contain', borderRadius: 12 } })
              )
            ) : null}
            <View style={styles.row} testID={`admin-verification-grant-${d.id}`}>
              <Text style={[type.caption, { color: colors.inkMuted, alignSelf: 'center' }]}>Approving makes them</Text>
              {(['mentor', 'verified'] as const).map((g) => (
                <ConsolePressable
                  key={g}
                  onPress={() => setGrant((m) => ({ ...m, [d.id]: g }))}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: grantOf(d) === g }}
                  testID={`admin-verification-grant-${g}-${d.id}`}
                  style={[
                    styles.chip,
                    grantOf(d) === g ? { backgroundColor: colors.accentTint, borderColor: colors.accent } : { borderColor: colors.border },
                  ]}
                >
                  <Text style={[type.label, { color: colors.ink }]}>{TIER_LABEL[g]}</Text>
                </ConsolePressable>
              ))}
            </View>
            {grantOf(d) === 'mentor' ? (
              <ExamCountsFields
                value={countsOf(d)}
                onChange={(v) => setCounts((m) => ({ ...m, [d.id]: v }))}
                testID={`admin-verification-counts-${d.id}`}
              />
            ) : null}
            <View style={styles.row}>
              <ConsolePressable onPress={() => void view(d)} disabled={busy === d.id} style={[styles.btn, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} testID={`admin-verification-view-${d.id}`}>
                <Text style={[type.label, { color: colors.ink }]}>{openId === d.id ? 'Reload' : 'View document'}</Text>
              </ConsolePressable>
              <ConsolePressable onPress={() => void decide(d, true)} disabled={busy === d.id || openId !== d.id || (grantOf(d) === 'mentor' && !canBeMentor(parseCounts(countsOf(d))))} style={[styles.btn, { backgroundColor: colors.accent, borderColor: colors.accent, opacity: openId === d.id && (grantOf(d) !== 'mentor' || canBeMentor(parseCounts(countsOf(d)))) ? 1 : 0.5 }]} testID={`admin-verification-approve-${d.id}`}>
                <Text style={[type.label, { color: colors.onAccent }]}>{`Approve as ${TIER_LABEL[grantOf(d)]}`}</Text>
              </ConsolePressable>
              <ConsolePressable onPress={() => setRejecting(rejecting === d.id ? null : d.id)} disabled={busy === d.id} style={[styles.btn, { backgroundColor: colors.surface, borderColor: colors.border }]} testID={`admin-verification-reject-${d.id}`}>
                <Text style={[type.label, { color: colors.danger }]}>Not approved</Text>
              </ConsolePressable>
            </View>
            {rejecting === d.id ? (
              <View style={styles.reject}>
                <TextInput
                  value={reason}
                  onChangeText={setReason}
                  maxLength={200}
                  placeholder="A short reason the mentor will see (optional)"
                  placeholderTextColor={colors.inkMuted}
                  style={[styles.field, { color: colors.ink, borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
                  testID={`admin-verification-reason-${d.id}`}
                />
                <ConsolePressable onPress={() => void decide(d, false)} disabled={busy === d.id} style={[styles.btn, { backgroundColor: colors.danger, borderColor: colors.danger }]} testID={`admin-verification-confirm-${d.id}`}>
                  <Text style={[type.label, { color: colors.onBrand }]}>Send decision and delete the file</Text>
                </ConsolePressable>
              </View>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  card: { borderWidth: 1, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  btn: { minHeight: 44, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1 },
  reject: { gap: space.sm },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingVertical: 6, paddingHorizontal: 12 },
  field: { minHeight: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, ...type.body },
});

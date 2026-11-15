/**
 * TierEditor: one control for a volunteer's tier (DECISIONS R.4) and the exam history an admin
 * checked (R.7, R.15). Peer listener <-> Mentor here; Mento Verified (in-service proof or an
 * invitation, founder 2026-11-15 option b) is granted or removed here too, with a confirm.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ExamCountsFields } from '@/components/admin/ExamCountsFields.web';
import { ConsolePressable } from '@/components/console/ConsolePressable';
import { ApiError } from '@/lib/api';
import { adminApi, type AdminListener } from '@/lib/adminApi';
import { badgeLine, canBeMentor, parseCounts, TIER_LABEL, type ExamCountsText } from '@/lib/adminTiers';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

export function TierEditor({ listener, onSaved }: { listener: AdminListener; onSaved: (message: string) => void }) {
  const { colors } = useTheme();
  const h = listener.exam_history ?? { prelims: 0, mains: 0, interview: 0 };
  const [text, setText] = useState<ExamCountsText>({
    prelims: h.prelims ? String(h.prelims) : '',
    mains: h.mains ? String(h.mains) : '',
    interview: h.interview ? String(h.interview) : '',
  });
  const [checked, setChecked] = useState(Boolean(listener.exam_history_checked));
  const [busy, setBusy] = useState(false);
  const [confirmVerified, setConfirmVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tier = listener.tier ?? 'listener';
  const counts = parseCounts(text);
  const name = listener.persona_name;

  const run = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setConfirmVerified(false);
      onSaved(message);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the tier. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const save = (next: 'listener' | 'mentor') =>
    run(
      () => adminApi.setListenerTier(listener.id, { tier: next, ...counts, exam_history_checked: checked }),
      next === 'mentor' ? `${name} is now a Mentor` : `${name} is now a Peer listener`,
    );

  const setVerified = (on: boolean) => {
    if (on && !confirmVerified) {
      setConfirmVerified(true);
      return;
    }
    void run(
      () => adminApi.certifyListener(listener.id, on),
      on ? `${name} is now Mento Verified` : `${name} is no longer Mento Verified`,
    );
  };

  const badges = badgeLine(listener.exam_history);
  return (
    <View style={[styles.box, { borderColor: colors.border }]} testID={`admin-listener-${listener.id}-tier`}>
      <Text style={[type.label, { color: colors.ink }]}>
        Tier: {TIER_LABEL[tier]}
        {badges ? `  ·  ${badges}${listener.exam_history_checked ? ' (proof checked)' : ' (not checked, hidden)'}` : ''}
      </Text>

      {tier === 'verified' ? (
        <ConsolePressable
          onPress={() => setVerified(false)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={`Remove Mento Verified from ${name}`}
          testID={`admin-listener-${listener.id}-certify`}
          style={[styles.btn, { borderColor: colors.border }]}
        >
          <Text style={[type.label, { color: colors.ink }]}>Remove Mento Verified</Text>
        </ConsolePressable>
      ) : (
        <>
          <ExamCountsFields
            value={text}
            onChange={setText}
            checked={checked}
            onChecked={setChecked}
            testID={`admin-listener-${listener.id}-tier`}
          />
          <View style={styles.row}>
            <ConsolePressable
              onPress={() => void save('mentor')}
              disabled={busy || !canBeMentor(counts)}
              accessibilityRole="button"
              accessibilityLabel={`Save ${name} as a Mentor`}
              testID={`admin-listener-${listener.id}-tier-mentor`}
              style={[styles.btn, { borderColor: colors.accent, opacity: busy || !canBeMentor(counts) ? 0.5 : 1 }]}
            >
              <Text style={[type.label, { color: colors.ink }]}>{tier === 'mentor' ? 'Save as Mentor' : 'Make Mentor'}</Text>
            </ConsolePressable>
            {tier === 'mentor' ? (
              <ConsolePressable
                onPress={() => void save('listener')}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`Make ${name} a Peer listener`}
                testID={`admin-listener-${listener.id}-tier-listener`}
                style={[styles.btn, { borderColor: colors.border }]}
              >
                <Text style={[type.label, { color: colors.ink }]}>Make Peer listener</Text>
              </ConsolePressable>
            ) : null}
            <ConsolePressable
              onPress={() => setVerified(true)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Make ${name} Mento Verified`}
              testID={`admin-listener-${listener.id}-certify`}
              style={[
                styles.btn,
                confirmVerified ? { backgroundColor: colors.accent, borderColor: colors.accent } : { borderColor: colors.border },
              ]}
            >
              <Text style={[type.label, { color: confirmVerified ? colors.onAccent : colors.ink }]}>
                {confirmVerified ? 'Confirm: in-service proof checked' : 'Make Mento Verified'}
              </Text>
            </ConsolePressable>
          </View>
          {!canBeMentor(counts) ? (
            <Text style={[type.caption, { color: colors.inkMuted }]}>A Mentor has cleared prelims at least once.</Text>
          ) : null}
        </>
      )}
      {error ? <Text style={[type.caption, { color: colors.danger }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.md, padding: space.sm, gap: space.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'flex-end' },
  btn: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
});

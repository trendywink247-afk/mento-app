/**
 * TierEditor — set an approved volunteer's tier (DECISIONS R.4) and the exam history an
 * admin checked (R.7, R.15). Mento Verified stays the separate "Verify for exams" action.
 * Mentor needs at least one prelims cleared (the server refuses otherwise). The badges show
 * to members only when "Proof checked" is on.
 */
import { useState } from 'react';
import { StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { ConsolePressable } from '@/components/console/ConsolePressable';
import { ApiError } from '@/lib/api';
import { adminApi, type AdminListener } from '@/lib/adminApi';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

const STAGES = ['prelims', 'mains', 'interview'] as const;
type Stage = (typeof STAGES)[number];
const LABEL: Record<Stage, string> = { prelims: 'Prelims', mains: 'Mains', interview: 'Interview' };

function count(text: string): number {
  const n = Number.parseInt(text, 10);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 20) : 0;
}

export function TierEditor({ listener, onSaved }: { listener: AdminListener; onSaved: (message: string) => void }) {
  const { colors } = useTheme();
  const h = listener.exam_history ?? { prelims: 0, mains: 0, interview: 0 };
  const [counts, setCounts] = useState<Record<Stage, string>>({
    prelims: String(h.prelims ?? 0),
    mains: String(h.mains ?? 0),
    interview: String(h.interview ?? 0),
  });
  const [checked, setChecked] = useState(Boolean(listener.exam_history_checked));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tier = listener.tier ?? 'listener';

  const save = async (next: 'listener' | 'mentor') => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.setListenerTier(listener.id, {
        tier: next,
        prelims: count(counts.prelims),
        mains: count(counts.mains),
        interview: count(counts.interview),
        exam_history_checked: checked,
      });
      onSaved(next === 'mentor' ? `${listener.persona_name} is now a Mentor` : `${listener.persona_name} is now a Listener`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not save the tier. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (tier === 'verified') {
    return (
      <Text style={[type.caption, { color: colors.inkMuted }]} testID={`admin-listener-${listener.id}-tier`}>
        Tier: Mento Verified (change with the verification button)
      </Text>
    );
  }

  return (
    <View style={[styles.box, { borderColor: colors.border }]} testID={`admin-listener-${listener.id}-tier`}>
      <Text style={[type.label, { color: colors.ink }]}>Tier: {tier === 'mentor' ? 'Mentor' : 'Peer listener'}</Text>
      <View style={styles.row}>
        {STAGES.map((s) => (
          <View key={s} style={styles.field}>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{LABEL[s]} cleared</Text>
            <TextInput
              value={counts[s]}
              onChangeText={(v) => setCounts((c) => ({ ...c, [s]: v.replace(/[^0-9]/g, '') }))}
              keyboardType="number-pad"
              maxLength={2}
              accessibilityLabel={`${LABEL[s]} cleared, times`}
              style={[styles.input, { borderColor: colors.border, color: colors.ink }]}
              testID={`admin-listener-${listener.id}-tier-${s}`}
            />
          </View>
        ))}
      </View>
      <View style={styles.checkRow}>
        <Switch
          value={checked}
          onValueChange={setChecked}
          accessibilityLabel="Proof checked: show exam badges to members"
          testID={`admin-listener-${listener.id}-tier-checked`}
        />
        <Text style={[type.caption, { color: colors.ink }]}>Proof checked (badges show to members)</Text>
      </View>
      {error ? <Text style={[type.caption, { color: colors.danger }]}>{error}</Text> : null}
      <View style={styles.row}>
        <ConsolePressable
          onPress={() => void save('mentor')}
          disabled={busy || count(counts.prelims) < 1}
          accessibilityRole="button"
          accessibilityLabel={`Save ${listener.persona_name} as a Mentor`}
          testID={`admin-listener-${listener.id}-tier-mentor`}
          style={[styles.btn, { borderColor: colors.accent, opacity: busy || count(counts.prelims) < 1 ? 0.5 : 1 }]}
        >
          <Text style={[type.label, { color: colors.ink }]}>{tier === 'mentor' ? 'Save as Mentor' : 'Make Mentor'}</Text>
        </ConsolePressable>
        {tier === 'mentor' ? (
          <ConsolePressable
            onPress={() => void save('listener')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Make ${listener.persona_name} a Peer listener`}
            testID={`admin-listener-${listener.id}-tier-listener`}
            style={[styles.btn, { borderColor: colors.border }]}
          >
            <Text style={[type.label, { color: colors.ink }]}>Make Listener</Text>
          </ConsolePressable>
        ) : null}
      </View>
      {count(counts.prelims) < 1 ? (
        <Text style={[type.caption, { color: colors.inkMuted }]}>A Mentor has cleared prelims at least once.</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: radius.md, padding: space.sm, gap: space.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, alignItems: 'flex-end' },
  field: { gap: 2 },
  input: { width: 72, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 8, paddingVertical: 6 },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  btn: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
});

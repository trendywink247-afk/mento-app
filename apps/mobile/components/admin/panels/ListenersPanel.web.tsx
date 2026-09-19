import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { ConsolePressable } from '@/components/console/ConsolePressable';
import { adminApi, type AdminApplication, type AdminListener } from '@/lib/adminApi';
import { formatTimestamp, formatTopic } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type, wash, washInk } from '@/theme/tokens';

/**
 * Listener roster + provisioning. Owners create listeners (categories + capacity),
 * copy their private console link, and suspend/reinstate — suspension revokes the
 * token instantly (T&S #9). Members are never shown here; listeners are personas.
 */
export default function ListenersPanel() {
  const { colors, elevation } = useTheme();
  const [listeners, setListeners] = useState<AdminListener[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [clearConfirmId, setClearConfirmId] = useState<string | null>(null);

  const [categories, setCategories] = useState('');
  const [maxConc, setMaxConc] = useState('3');
  const [creating, setCreating] = useState(false);

  const [applications, setApplications] = useState<AdminApplication[] | null>(null);
  const [declineId, setDeclineId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');

  const load = async () => {
    try {
      setListeners(await adminApi.listeners());
      setError(null);
    } catch {
      setError('Could not load the listener roster. Retry shortly.');
    }
  };

  const loadApplications = async () => {
    try {
      setApplications(await adminApi.listApplications('pending'));
    } catch {
      setError('Could not load pending applications. Retry shortly.');
    }
  };

  useEffect(() => {
    void load();
    void loadApplications();
  }, []);

  const approve = async (id: string) => {
    setBusy(id);
    setError(null);
    setConfirmId(null);
    try {
      await adminApi.approveApplication(id);
      setToast('Application approved — listener added to the roster');
      await Promise.all([loadApplications(), load()]);
    } catch {
      setError('Could not approve that application. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const decline = async (id: string) => {
    // First press opens the reason input; second press (reason ≥3 chars) submits.
    if (declineId !== id) {
      setDeclineId(id);
      setDeclineReason('');
      return;
    }
    const reason = declineReason.trim();
    if (reason.length < 3) return;
    setBusy(id);
    setError(null);
    setConfirmId(null);
    try {
      await adminApi.declineApplication(id, reason);
      setToast('Application declined');
      setDeclineId(null);
      setDeclineReason('');
      await loadApplications();
    } catch {
      setError('Could not decline that application. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const create = async () => {
    setCreating(true);
    setError(null);
    setConfirmId(null);
    try {
      const parsed = categories
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      const created = await adminApi.createListener(parsed, Number(maxConc) || 1);
      setListeners((prev) => (prev ? [created, ...prev] : [created]));
      setCategories('');
      setMaxConc('3');
      setToast('Listener created');
    } catch {
      setError('Could not create that listener. Try again.');
    } finally {
      setCreating(false);
    }
  };

  const setStatus = async (id: string, action: 'suspend' | 'reinstate') => {
    if (action === 'suspend' && confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setBusy(id);
    setError(null);
    setConfirmId(null);
    try {
      if (action === 'suspend') await adminApi.suspendListener(id);
      else await adminApi.reinstateListener(id);
      await load();
    } catch {
      setError("Couldn't update that listener. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const clearLine = async (id: string) => {
    if (clearConfirmId !== id) {
      setClearConfirmId(id);
      return;
    }
    setBusy(id);
    setError(null);
    setClearConfirmId(null);
    try {
      await adminApi.clearListenerLine(id);
      setToast('Line cleared');
      await load();
    } catch {
      setError("Couldn't clear that line. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async (id: string) => {
    setBusy(id);
    setError(null);
    setConfirmId(null);
    try {
      const { url } = await adminApi.listenerLink(id);
      await navigator.clipboard.writeText(url);
      setToast('Console link copied');
    } catch {
      setError('Could not copy the console link. Try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.body} testID="admin-panel-listeners">
      {/* Add listener */}
      <View style={[styles.card, { backgroundColor: colors.surface }, elevation.sm]}>
        <Text style={[type.bodySemi, { color: colors.ink }]}>Add listener</Text>
        <TextInput
          value={categories}
          onChangeText={setCategories}
          placeholder="Categories (comma-separated)"
          placeholderTextColor={colors.inkMuted}
          accessibilityLabel="Categories (comma-separated)"
          style={[styles.input, { borderColor: colors.border, color: colors.ink }]}
          testID="admin-listener-categories"
        />
        <TextInput
          value={maxConc}
          onChangeText={setMaxConc}
          placeholder="Max concurrent"
          placeholderTextColor={colors.inkMuted}
          accessibilityLabel="Max concurrent"
          keyboardType="number-pad"
          style={[styles.input, { borderColor: colors.border, color: colors.ink }]}
          testID="admin-listener-maxconc"
        />
        <ConsolePressable
          onPress={() => void create()}
          disabled={creating}
          accessibilityRole="button"
          testID="admin-listener-create"
          style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
        >
          <Text style={[type.label, { color: colors.onAccent }]}>
            {creating ? 'Creating…' : 'Create'}
          </Text>
        </ConsolePressable>
      </View>

      {error ? <Text style={[type.caption, { color: colors.danger }]}>{error}</Text> : null}
      {toast ? <Text style={[type.caption, { color: colors.ink }]}>{toast}</Text> : null}

      {/* Pending listener applications — the human half of the become-a-listener funnel */}
      <View style={styles.section} testID="admin-applications">
        <Text style={[type.bodySemi, { color: colors.ink }]}>Applications</Text>
        {!applications ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.accent} />
          </View>
        ) : applications.length === 0 ? (
          <Text style={[type.caption, { color: colors.inkMuted }]}>No pending applications.</Text>
        ) : (
          applications.map((app) => (
            <View
              key={app.id}
              style={[styles.card, { backgroundColor: colors.surface }, elevation.sm]}
              testID={`admin-app-${app.id}`}
            >
              <View style={styles.rosterHead}>
                <PersonaAvatar name={app.persona_name} size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.bodySemi, { color: colors.ink }]}>{app.persona_name}</Text>
                  <Text style={[type.caption, styles.rosterNums, { color: colors.inkMuted }]}>
                    {[
                      formatTopic(app.availability),
                      // Board A37 time-of-day chips (older applications have none).
                      ...(app.available_times ?? []).map(formatTopic),
                      formatTimestamp(app.created_at),
                    ].join(' · ')}
                  </Text>
                </View>
                {app.mentor_interest ? (
                  <View style={[styles.chip, { backgroundColor: colors.surfaceAlt }]}>
                    <Text style={[type.caption, { color: colors.ink }]}>Mentor interest</Text>
                  </View>
                ) : null}
              </View>

              <Text style={[type.body, { color: colors.ink }]}>{app.motivation}</Text>

              {app.communities.length > 0 ? (
                <View style={styles.chips}>
                  {app.communities.map((c) => (
                    <View key={c} style={[styles.chip, { backgroundColor: colors.surfaceAlt }]}>
                      <Text style={[type.caption, { color: colors.ink }]}>{formatTopic(c)}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {declineId === app.id ? (
                <TextInput
                  value={declineReason}
                  onChangeText={setDeclineReason}
                  placeholder="Reason for declining (kept internal)"
                  placeholderTextColor={colors.inkMuted}
                  accessibilityLabel="Reason for declining"
                  style={[styles.input, { borderColor: colors.border, color: colors.ink }]}
                  testID={`admin-app-decline-reason-${app.id}`}
                />
              ) : null}

              <View style={styles.actions}>
                <ConsolePressable
                  onPress={() => void approve(app.id)}
                  disabled={busy === app.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Approve ${app.persona_name}`}
                  testID={`admin-app-approve-${app.id}`}
                  style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
                >
                  <Text style={[type.label, { color: colors.onAccent }]}>
                    {busy === app.id ? 'Working…' : 'Approve'}
                  </Text>
                </ConsolePressable>
                <ConsolePressable
                  onPress={() => void decline(app.id)}
                  disabled={
                    busy === app.id ||
                    (declineId === app.id && declineReason.trim().length < 3)
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Decline ${app.persona_name}`}
                  testID={`admin-app-decline-${app.id}`}
                  style={[styles.secondaryBtn, { borderColor: colors.border }]}
                >
                  <Text style={[type.label, { color: colors.danger }]}>
                    {declineId === app.id ? 'Confirm decline' : 'Decline'}
                  </Text>
                </ConsolePressable>
              </View>
            </View>
          ))
        )}
      </View>

      <Text style={[type.bodySemi, { color: colors.ink }]}>Roster</Text>
      {!listeners ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : listeners.length === 0 ? (
        <Text style={[type.caption, { color: colors.inkMuted }]}>No listeners yet.</Text>
      ) : (
        listeners.map((li) => {
          const approved = li.vetting_status === 'approved';
          const suspended = li.vetting_status === 'suspended';
          return (
            <View
              key={li.id}
              style={[styles.card, { backgroundColor: colors.surface }, elevation.sm]}
              testID={`admin-listener-${li.id}`}
            >
              <View style={styles.rosterHead}>
                <PersonaAvatar name={li.persona_name} size={44} online={li.status === 'online'} />
                <View style={{ flex: 1 }}>
                  <Text style={[type.bodySemi, { color: colors.ink }]}>{li.persona_name}</Text>
                  <Text style={[type.caption, styles.rosterNums, { color: colors.inkMuted }]}>
                    {li.vetting_status} · {li.status} · {li.active_conversations}/{li.max_concurrent}{' '}
                    · rank {li.rank}
                  </Text>
                </View>
              </View>

              {li.step_back_requested_at ? (
                <View
                  style={[styles.stepBack, { backgroundColor: approved ? wash.danger : colors.surfaceAlt }]}
                  testID={`admin-listener-${li.id}-step-back`}
                >
                  <Text style={[type.label, { color: approved ? washInk.danger : colors.inkMuted }]}>
                    {approved
                      ? `Asked to step back · ${new Date(li.step_back_requested_at).toLocaleString()} — suspend to step their mentor side back; then they can Start fresh.`
                      : `Asked to step back · ${new Date(li.step_back_requested_at).toLocaleString()} — done.`}
                  </Text>
                  {li.step_back_reason ? (
                    <Text style={[type.caption, { color: colors.ink }]}>“{li.step_back_reason}”</Text>
                  ) : null}
                </View>
              ) : null}

              <Text
                style={[
                  type.caption,
                  li.public_line ? styles.publicLine : null,
                  { color: colors.inkMuted },
                ]}
                testID={`admin-listener-${li.id}-line`}
              >
                {li.public_line ?? '—'}
              </Text>

              {li.categories.length > 0 ? (
                <View style={styles.chips}>
                  {li.categories.map((c) => (
                    <View key={c} style={[styles.chip, { backgroundColor: colors.surfaceAlt }]}>
                      <Text style={[type.caption, { color: colors.ink }]}>{c}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={styles.actions}>
                {approved ? (
                  <ConsolePressable
                    onPress={() => void setStatus(li.id, 'suspend')}
                    disabled={busy === li.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Suspend ${li.persona_name}`}
                    testID={`admin-listener-${li.id}-suspend`}
                    style={[
                      styles.secondaryBtn,
                      confirmId === li.id
                        ? { backgroundColor: colors.danger, borderColor: colors.danger }
                        : { borderColor: colors.border },
                    ]}
                  >
                    <Ionicons
                      name="alert-circle-outline"
                      size={14}
                      color={confirmId === li.id ? colors.onAccent : colors.danger}
                    />
                    <Text
                      style={[
                        type.label,
                        { color: confirmId === li.id ? colors.onAccent : colors.danger },
                      ]}
                    >
                      {confirmId === li.id ? 'Confirm suspend?' : 'Suspend'}
                    </Text>
                  </ConsolePressable>
                ) : null}
                {suspended ? (
                  <ConsolePressable
                    onPress={() => void setStatus(li.id, 'reinstate')}
                    disabled={busy === li.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Reinstate ${li.persona_name}`}
                    testID={`admin-listener-${li.id}-reinstate`}
                    style={[styles.secondaryBtn, { borderColor: colors.border }]}
                  >
                    <Text style={[type.label, { color: colors.success }]}>Reinstate</Text>
                  </ConsolePressable>
                ) : null}
                <ConsolePressable
                  onPress={() => void copyLink(li.id)}
                  disabled={busy === li.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Copy console link for ${li.persona_name}`}
                  testID={`admin-listener-${li.id}-copy`}
                  style={[styles.secondaryBtn, { borderColor: colors.border }]}
                >
                  <Text style={[type.label, { color: colors.ink }]}>Copy link</Text>
                </ConsolePressable>
                <ConsolePressable
                  onPress={() => void clearLine(li.id)}
                  disabled={busy === li.id || !li.public_line}
                  accessibilityRole="button"
                  accessibilityLabel={`Clear line for ${li.persona_name}`}
                  testID={`admin-listener-${li.id}-clear-line`}
                  style={[
                    styles.secondaryBtn,
                    { borderColor: colors.border },
                    !li.public_line && styles.disabledBtn,
                  ]}
                >
                  <Text style={[type.label, { color: colors.ink }]}>
                    {clearConfirmId === li.id ? 'Confirm clear' : 'Clear line'}
                  </Text>
                </ConsolePressable>
              </View>
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  section: { gap: space.sm },
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  card: { borderRadius: radius.lg, padding: space.md, gap: space.sm },
  input: {
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.fontSize,
    minHeight: 42,
  },
  rosterHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rosterNums: { fontVariant: ['tabular-nums'] },
  publicLine: { fontStyle: 'italic' },
  stepBack: { borderRadius: radius.md, paddingVertical: space.sm, paddingHorizontal: space.md, gap: 2 },
  disabledBtn: { opacity: 0.4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: {
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: space.sm,
  },
  actions: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  primaryBtn: {
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  secondaryBtn: {
    flexDirection: 'row',
    gap: space.xs,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

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
import { adminApi, type AdminListener } from '@/lib/adminApi';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

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

  const [categories, setCategories] = useState('');
  const [maxConc, setMaxConc] = useState('3');
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      setListeners(await adminApi.listeners());
      setError(null);
    } catch {
      setError('Could not load the listener roster. Retry shortly.');
    }
  };

  useEffect(() => {
    void load();
  }, []);

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

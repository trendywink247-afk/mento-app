import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ConsolePressable } from '@/components/console/ConsolePressable';
import {
  adminApi,
  type AdminAccountItem,
  type AdminAuditItem,
} from '@/lib/adminApi';
import { formatTimestamp } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/**
 * Owner-only admin management + audit trail. New admins get a one-time console URL
 * shown in a copyable field; owners can't be revoked, and the audit log records every
 * privileged action newest-first.
 */
export default function AdminsPanel() {
  const { colors, elevation } = useTheme();
  const [admins, setAdmins] = useState<AdminAccountItem[] | null>(null);
  const [audit, setAudit] = useState<AdminAuditItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [newUrl, setNewUrl] = useState<string | null>(null);

  const loadAdmins = async () => {
    try {
      setAdmins(await adminApi.admins());
    } catch {
      setError('Could not load admins. Retry shortly.');
    }
  };

  const loadAudit = async () => {
    try {
      setAudit(await adminApi.audit());
    } catch {
      setError('Could not load the audit log. Retry shortly.');
    }
  };

  useEffect(() => {
    void loadAdmins();
    void loadAudit();
  }, []);

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    setConfirmId(null);
    try {
      const { url } = await adminApi.createAdmin(name.trim());
      setNewUrl(url);
      setName('');
      setToast('Admin created — copy their link below');
      await loadAdmins();
      await loadAudit();
    } catch {
      setError('Could not create that admin. Try again.');
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (id: string) => {
    if (confirmId !== id) {
      setConfirmId(id);
      return;
    }
    setBusy(id);
    setError(null);
    setConfirmId(null);
    try {
      await adminApi.revokeAdmin(id);
      await loadAdmins();
      await loadAudit();
    } catch {
      setError('Could not revoke that admin. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const copyUrl = async () => {
    if (!newUrl) return;
    try {
      await navigator.clipboard.writeText(newUrl);
      setToast('Link copied');
    } catch {
      setError('Could not copy the link.');
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.body} testID="admin-panel-admins">
      {/* Add admin */}
      <View style={[styles.card, { backgroundColor: colors.surface }, elevation.sm]}>
        <Text style={[type.bodySemi, { color: colors.ink }]}>Add admin</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Name"
          placeholderTextColor={colors.inkMuted}
          accessibilityLabel="Name"
          style={[styles.input, { borderColor: colors.border, color: colors.ink }]}
          testID="admin-admins-name"
        />
        <ConsolePressable
          onPress={() => void create()}
          disabled={creating}
          accessibilityRole="button"
          testID="admin-admins-create"
          style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
        >
          <Text style={[type.label, { color: colors.onAccent }]}>
            {creating ? 'Creating…' : 'Create'}
          </Text>
        </ConsolePressable>
        {newUrl ? (
          <View style={[styles.urlField, { backgroundColor: colors.surfaceAlt }]}>
            <Text
              selectable
              numberOfLines={1}
              style={[type.caption, { color: colors.ink, flex: 1 }]}
              testID="admin-admins-new-url"
            >
              {newUrl}
            </Text>
            <ConsolePressable
              onPress={() => void copyUrl()}
              accessibilityRole="button"
              accessibilityLabel="Copy new admin console link"
              testID="admin-admins-copy-url"
              style={styles.copyBtn}
            >
              <Text style={[type.label, { color: colors.accent }]}>Copy</Text>
            </ConsolePressable>
          </View>
        ) : null}
      </View>

      {error ? <Text style={[type.caption, { color: colors.danger }]}>{error}</Text> : null}
      {toast ? <Text style={[type.caption, { color: colors.ink }]}>{toast}</Text> : null}

      {/* Admins */}
      <Text style={[styles.section, { color: colors.ink }]}>Admins</Text>
      {!admins ? (
        <ActivityIndicator color={colors.accent} />
      ) : admins.length === 0 ? (
        <Text style={[type.caption, { color: colors.inkMuted }]}>
          No admins yet — create the first one above.
        </Text>
      ) : (
        admins.map((a) => {
          const isOwner = a.role === 'owner';
          const revoked = a.status === 'revoked';
          return (
            <View
              key={a.id}
              style={[styles.row, { backgroundColor: colors.surface }, elevation.sm]}
              testID={`admin-admins-${a.id}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={[type.bodySemi, { color: colors.ink }]}>{a.name}</Text>
                <Text style={[type.caption, { color: colors.inkMuted }]}>
                  {a.role} · {a.status}
                </Text>
              </View>
              {!isOwner && !revoked ? (
                <ConsolePressable
                  onPress={() => void revoke(a.id)}
                  disabled={busy === a.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Revoke ${a.name}`}
                  testID={`admin-admins-${a.id}-revoke`}
                  style={[
                    styles.secondaryBtn,
                    confirmId === a.id
                      ? { backgroundColor: colors.danger, borderColor: colors.danger }
                      : { borderColor: colors.border },
                  ]}
                >
                  <Ionicons
                    name="alert-circle-outline"
                    size={14}
                    color={confirmId === a.id ? colors.onAccent : colors.danger}
                  />
                  <Text
                    style={[
                      type.label,
                      { color: confirmId === a.id ? colors.onAccent : colors.danger },
                    ]}
                  >
                    {confirmId === a.id ? 'Confirm revoke?' : 'Revoke'}
                  </Text>
                </ConsolePressable>
              ) : null}
            </View>
          );
        })
      )}

      {/* Audit log */}
      <Text style={[styles.section, { color: colors.ink }]}>Audit log</Text>
      {!audit ? (
        <ActivityIndicator color={colors.accent} />
      ) : audit.length === 0 ? (
        <Text style={[type.caption, { color: colors.inkMuted }]}>No activity yet.</Text>
      ) : (
        <View style={[styles.card, { backgroundColor: colors.surface }, elevation.sm]}>
          {audit.map((entry) => (
            <View
              key={entry.id}
              style={[styles.auditRow, { borderColor: colors.border }]}
              testID={`admin-audit-${entry.id}`}
            >
              <View style={{ flex: 1 }}>
                <Text style={[type.body, { color: colors.ink }]}>
                  {entry.admin_name} · {entry.action}
                </Text>
                <Text style={[type.caption, { color: colors.inkMuted }]}>
                  {entry.subject_type ?? '—'} · {formatTimestamp(entry.created_at)}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  card: { borderRadius: radius.lg, padding: space.md, gap: space.sm },
  section: {
    ...type.titleSmSerif,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  input: {
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    fontFamily: type.body.fontFamily,
    fontSize: type.body.fontSize,
    minHeight: 42,
  },
  urlField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.sm,
  },
  copyBtn: {
    minHeight: 44,
    paddingHorizontal: space.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.md,
  },
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
  auditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.sm,
    borderBottomWidth: 1,
  },
});

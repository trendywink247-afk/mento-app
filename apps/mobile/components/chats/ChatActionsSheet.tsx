import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/**
 * What a long-press or a swipe on a chat offers: Pin, Archive, Mute and Delete (founder, 2026-11-10,
 * like WhatsApp). Pin and Archive stay on this phone; Mute is the chat's Quiet Pause; Delete is the real
 * Clean Wipe and asks once more. Drawn inline over the list (no Modal: the Android new-arch blank-modal gotcha).
 */
export function ChatActionsSheet({
  name,
  pinned,
  archived,
  muted,
  canMute,
  busy,
  startConfirming = false,
  onPin,
  onArchive,
  onMute,
  onDelete,
  onClose,
}: {
  name: string;
  pinned: boolean;
  archived: boolean;
  muted: boolean;
  canMute: boolean;
  busy: boolean;
  /** Open straight on the "Delete for good?" question (the swipe's Delete). */
  startConfirming?: boolean;
  onPin: () => void;
  onArchive: () => void;
  onMute: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { colors, elevation } = useTheme();
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(startConfirming);
  const rows: { key: string; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void; danger?: boolean; hide?: boolean }[] = [
    { key: 'pin', icon: pinned ? 'pin-outline' : 'pin', label: pinned ? t('chatActions.unpin') : t('chatActions.pin'), onPress: onPin },
    { key: 'archive', icon: archived ? 'arrow-undo-outline' : 'archive-outline', label: archived ? t('chatActions.unarchive') : t('chatActions.archive'), onPress: onArchive },
    { key: 'mute', icon: muted ? 'notifications-outline' : 'notifications-off-outline', label: muted ? t('chatActions.unmute') : t('chatActions.mute'), onPress: onMute, hide: !canMute },
    { key: 'delete', icon: 'trash-outline', label: t('chatActions.delete'), onPress: () => setConfirming(true), danger: true },
  ];
  return (
    <Pressable style={[styles.backdrop, { backgroundColor: colors.scrim }]} onPress={onClose} accessibilityLabel={t('common.cancel')} testID="chat-actions-backdrop">
      <Pressable style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, elevation.md]} onPress={() => {}} testID="chat-actions-sheet">
        <Text style={[type.sheetTitle, styles.title, { color: colors.ink }]} numberOfLines={1}>
          {name}
        </Text>
        {confirming ? (
          <View style={styles.confirm}>
            <Text style={[type.label, { color: colors.ink }]}>{t('chatActions.deleteTitle')}</Text>
            <Text style={[type.body, { color: colors.inkMuted }]}>{t('chatActions.deleteBody')}</Text>
            <PrimaryButton label={t('chatActions.deleteConfirm')} onPress={onDelete} loading={busy} testID="chat-delete-confirm" />
            <PrimaryButton label={t('common.cancel')} variant="link" onPress={() => setConfirming(false)} testID="chat-delete-cancel" />
          </View>
        ) : (
          rows
            .filter((r) => !r.hide)
            .map((r) => (
              <Pressable
                key={r.key}
                onPress={r.onPress}
                disabled={busy}
                style={[styles.row, { borderTopColor: colors.border }]}
                accessibilityRole="button"
                testID={`chat-action-${r.key}`}
              >
                <Ionicons name={r.icon} size={22} color={r.danger ? colors.danger : colors.ink} />
                <Text style={[type.body, { color: r.danger ? colors.danger : colors.ink }]}>{r.label}</Text>
              </Pressable>
            ))
        )}
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'flex-end', padding: space.md, zIndex: 20 },
  card: { borderRadius: radius.xl, borderWidth: 1, paddingTop: space.md, paddingBottom: space.sm, paddingHorizontal: space.md },
  title: { paddingBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth },
  confirm: { gap: space.sm, paddingBottom: space.sm },
});

/**
 * MessageActions — what holding a message offers. A quiet bottom sheet over the settled chat:
 * the message's first lines for context, then the rows that apply to THIS message:
 *   - Copy (always): the words go to the clipboard; the row says "Copied" and the sheet closes.
 *   - Save to Journal (a mentor's message the member has not saved yet).
 *   - Report this chat (the other person's message): hands to the existing report flow, which
 *     reports the conversation, never one line of it — so nothing about a message leaves the
 *     chat unless the member asks.
 * Nothing buzzes or warns (T&S #11): one light tick on press, stillness otherwise.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptic } from '@/lib/haptics';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

type Props = {
  visible: boolean;
  text: string;
  /** Show "Save to Journal" and run it. Omit when the message cannot or need not be saved. */
  onSave?: () => void;
  /** Show "Report this chat" and run it. Omit on the member's own messages. */
  onReport?: () => void;
  onClose: () => void;
};

export function MessageActions({ visible, text, onSave, onReport, onClose }: Props) {
  const { t } = useI18n();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (visible) setCopied(false);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [visible]);

  const copy = () => {
    haptic.tick();
    Clipboard.setStringAsync(text).then(() => {
      setCopied(true);
      timer.current = setTimeout(onClose, 650);
    }).catch(onClose);
  };
  const run = (action: () => void) => () => { haptic.tick(); onClose(); action(); };

  const rows: { key: string; icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }[] = [
    { key: 'copy', icon: copied ? 'checkmark' : 'copy-outline', label: copied ? t('chat.msgCopied') : t('chat.msgCopy'), onPress: copy },
  ];
  if (onSave) rows.push({ key: 'save', icon: 'bookmark-outline', label: t('chat.saveToNotes'), onPress: run(onSave) });
  if (onReport) rows.push({ key: 'report', icon: 'flag-outline', label: t('chat.msgReport'), onPress: run(onReport) });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.ink, opacity: 0.38 }]}
          onPress={onClose} accessibilityRole="button" accessibilityLabel={t('chat.msgClose')} testID="message-actions-scrim" />
        <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: space.md + insets.bottom }]}
          accessibilityViewIsModal testID="message-actions">
          <View style={[styles.grab, { backgroundColor: colors.border }]} />
          <Text style={[type.caption, { color: colors.inkMuted }]}>{t('chat.msgActionsTitle')}</Text>
          <Text numberOfLines={2} style={[type.body, { color: colors.ink }]} maxFontSizeMultiplier={1.3}>{text}</Text>
          <View style={[styles.rule, { backgroundColor: colors.border }]} />
          {rows.map(row => (
            <Pressable key={row.key} onPress={row.onPress} accessibilityRole="button" accessibilityLabel={row.label}
              testID={`message-action-${row.key}`}
              style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.accentTint }]}>
              <Ionicons name={row.icon} size={22} color={colors.accent} />
              <Text style={[styles.label, { color: colors.ink }]} maxFontSizeMultiplier={1.3}>{row.label}</Text>
            </Pressable>
          ))}
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('chat.msgClose')}
            testID="message-action-close" style={styles.close}>
            <Text style={[styles.label, { color: colors.inkMuted }]} maxFontSizeMultiplier={1.3}>{t('chat.msgClose')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: space.lg, paddingTop: space.sm, gap: space.sm },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: radius.sm, marginBottom: space.sm },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: space.xs },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 52, paddingHorizontal: space.sm, borderRadius: radius.md },
  label: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 22 },
  close: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});

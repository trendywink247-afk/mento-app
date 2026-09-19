import { useEffect, useState } from 'react';
import { Keyboard, Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Entrance } from '@/components/motion/Entrance';
import { useI18n } from '@/lib/i18n';
import { listenerApi, type ListenerMe } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

export const LINE_MAX = 120;
const NOTE_MAX = 60;

/** Lifts the sheet's content above the software keyboard on native (the sheet is pinned to
 * the bottom edge). Web has no software keyboard to dodge. */
function useKeyboardRoom(): number {
  const [room, setRoom] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) =>
      setRoom(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setRoom(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return room;
}

/**
 * "Your line" (spec §3.3, Mentor Home): the mentor's one-sentence public line + when
 * they're usually around — both shown on the member-side mentor profile. Rendered as the
 * board's sheet (FINAL_SPEC: "line sheet") inside Mentor Home's `SettleBack`, so Mentor Home
 * stays behind it, settled back under the scrim — like the stay-in-touch sheet (A15).
 *
 * The fields start from the `me` Mentor Home already holds (no blank-then-filled flash),
 * the line is a MULTI-LINE field so the whole sentence is always visible, and the counter
 * is the field's own live length. Saved via PUT /listener/me/profile (10/h server limit);
 * a failure is a still line (T&S #11).
 */
export function LineSheet({
  me,
  onClose,
  onSaved,
}: {
  me: Pick<ListenerMe, 'public_line' | 'availability_note'>;
  onClose: () => void;
  /** The server's answer, so Mentor Home shows the saved line at once. */
  onSaved: (me: ListenerMe) => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const keyboard = useKeyboardRoom();

  const [line, setLine] = useState(me.public_line ?? '');
  const [availability, setAvailability] = useState(me.availability_note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      const out = await listenerApi.updateProfile({
        public_line: line.trim() ? line.trim() : null,
        availability_note: availability.trim() ? availability.trim() : null,
      });
      onSaved(out);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.body, { paddingBottom: keyboard }]} testID="line-sheet">
      <Entrance index={2} style={styles.head}>
        <IconBadge icon="pencil-outline" tone="accent" size={44} />
        <View style={styles.headText}>
          <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
            {t('mentor.line.title')}
          </Text>
          <Text style={[type.note, { color: colors.inkMuted }]}>{t('mentor.line.body')}</Text>
        </View>
      </Entrance>

      <Entrance index={3} style={styles.field}>
        <TextInput
          value={line}
          // One sentence: a return key never breaks the line (the server collapses it anyway).
          onChangeText={(v) => setLine(v.replace(/\n/g, ' ').slice(0, LINE_MAX))}
          maxLength={LINE_MAX}
          multiline
          scrollEnabled={false}
          textAlignVertical="top"
          placeholder={t('mentorLineSheet.placeholder')}
          placeholderTextColor={colors.inkMuted}
          style={[
            type.body,
            styles.input,
            styles.lineInput,
            { backgroundColor: colors.surface, borderColor: colors.border, color: colors.ink },
          ]}
          testID="line-input"
          accessibilityLabel={t('mentor.line.title')}
          maxFontSizeMultiplier={1.3}
        />
        <Text
          style={[type.caption, styles.counter, { color: colors.inkMuted }]}
          testID="line-counter"
          accessibilityLabel={t('mentorLineSheet.counterA11y', { count: line.length, max: LINE_MAX })}
        >
          {line.length}/{LINE_MAX}
        </Text>
      </Entrance>

      <Entrance index={4} style={styles.field}>
        <Text style={[type.label, { color: colors.ink }]}>{t('mentor.line.availability')}</Text>
        <TextInput
          value={availability}
          onChangeText={(v) => setAvailability(v.slice(0, NOTE_MAX))}
          maxLength={NOTE_MAX}
          placeholder={t('mentor.line.availabilityPlaceholder')}
          placeholderTextColor={colors.inkMuted}
          style={[type.body, styles.input, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.ink }]}
          testID="line-availability"
          accessibilityLabel={t('mentor.line.availability')}
          maxFontSizeMultiplier={1.3}
        />
      </Entrance>

      {error ? (
        <Text style={[type.caption, { color: colors.inkMuted }]} testID="line-error" accessibilityLiveRegion="polite">
          {t('mentorProfile.saveFailed')}
        </Text>
      ) : null}

      <Entrance index={5} style={styles.keys}>
        <PrimaryButton label={t('mentor.line.save')} onPress={() => void save()} loading={saving} testID="line-save" />
        <PrimaryButton
          label={t('common.cancel')}
          variant="link"
          onPress={onClose}
          disabled={saving}
          testID="line-cancel"
        />
      </Entrance>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  headText: { flex: 1, minWidth: 0, gap: 2 },
  title: { fontSize: 22, lineHeight: 28, fontFamily: font.sansHeavy },
  field: { gap: space.xs },
  input: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, minHeight: 48 },
  // Three lines of body text: a full 120-character line always shows whole (at 360 wide too).
  lineInput: { minHeight: 96 },
  counter: { textAlign: 'right' },
  keys: { gap: space.xs },
});

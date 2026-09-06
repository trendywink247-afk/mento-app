import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { useI18n } from '@/lib/i18n';
import { listenerApi } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/**
 * "Your line" editor (spec §3.3): the mentor's one-sentence public line + when
 * they're usually around — both shown on the member-side mentor profile
 * (components/chat/MentorProfileScreen.tsx). Saved via PUT /listener/me/profile
 * (server-side 10/h rate limit). Fields are pre-filled from a fresh /listener/me
 * fetch on mount rather than a prop, so the sheet always edits the server's
 * current values even if PresenceHeader's `me` is a beat stale.
 */
export function LineSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();

  const [line, setLine] = useState('');
  const [availability, setAvailability] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void listenerApi
      .me()
      .then((me) => {
        if (!active) return;
        setLine(me.public_line ?? '');
        setAvailability(me.availability_note ?? '');
      })
      .catch(() => {
        // Sheet still opens with blank fields — saving still works from here.
      });
    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(false);
    try {
      await listenerApi.updateProfile({
        public_line: line.trim() ? line.trim() : null,
        availability_note: availability.trim() ? availability.trim() : null,
      });
      onSaved();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]} testID="line-sheet">
      <Text style={[styles.title, { color: colors.ink }]}>{t('mentor.line.title')}</Text>
      <Text style={[type.body, { color: colors.inkMuted }]}>{t('mentor.line.body')}</Text>

      <TextInput
        value={line}
        onChangeText={(v) => setLine(v.slice(0, 120))}
        maxLength={120}
        multiline
        placeholder={t('mentor.line.placeholder')}
        placeholderTextColor={colors.inkMuted}
        style={[type.body, styles.input, { backgroundColor: colors.surfaceAlt, color: colors.ink }]}
        testID="line-input"
        accessibilityLabel={t('mentor.line.title')}
        maxFontSizeMultiplier={1.3}
      />
      <Text style={[type.caption, styles.counter, { color: colors.inkMuted }]}>{line.length}/120</Text>

      <Text style={[type.label, { color: colors.ink }]}>{t('mentor.line.availability')}</Text>
      <TextInput
        value={availability}
        onChangeText={(v) => setAvailability(v.slice(0, 60))}
        maxLength={60}
        placeholder={t('mentor.line.availabilityPlaceholder')}
        placeholderTextColor={colors.inkMuted}
        style={[type.body, styles.availabilityInput, { backgroundColor: colors.surfaceAlt, color: colors.ink }]}
        testID="line-availability"
        accessibilityLabel={t('mentor.line.availability')}
        maxFontSizeMultiplier={1.3}
      />

      {error ? (
        <Text style={[type.caption, { color: colors.danger }]} testID="line-error">
          {t('mentorProfile.saveFailed')}
        </Text>
      ) : null}

      <PrimaryButton
        label={t('mentor.line.save')}
        onPress={() => void save()}
        loading={saving}
        testID="line-save"
      />
      <PrimaryButton
        label={t('common.cancel')}
        variant="link"
        onPress={onClose}
        disabled={saving}
        testID="line-cancel"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
    maxWidth: 420,
  },
  title: { fontFamily: font.sansHeavy, fontSize: 20, lineHeight: 26 },
  input: { borderRadius: radius.md, padding: space.sm, minHeight: 72, textAlignVertical: 'top' },
  counter: { textAlign: 'right' },
  availabilityInput: { borderRadius: radius.md, padding: space.sm, minHeight: 44 },
});

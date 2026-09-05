import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n, type TKey } from '@/lib/i18n';
import { listenerApi, type ListenerReportReason } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

const REASONS: { key: ListenerReportReason; label: TKey }[] = [
  { key: 'abuse', label: 'mentor.reportSheet.abuse' },
  { key: 'harassment', label: 'mentor.reportSheet.harassment' },
  { key: 'spam', label: 'mentor.reportSheet.spam' },
  { key: 'other', label: 'mentor.reportSheet.other' },
];

type State = 'idle' | 'sending' | 'sent' | 'error';

/** Report-conversation sheet, presented as a transparentModal route
 * (app/mentor/_layout.tsx) — same scrim + centred-card pattern as
 * app/start-fresh.tsx. Reviewed by a human moderator; the member is never told
 * who reported (mentor.reportSheet.body). */
export default function MentorReportRoute() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [state, setState] = useState<State>('idle');
  const [reason, setReason] = useState<ListenerReportReason | null>(null);
  const [note, setNote] = useState('');

  const close = () => {
    if (state === 'sending') return;
    router.back();
  };

  const submit = async () => {
    if (!reason || state === 'sending') return;
    setState('sending');
    try {
      await listenerApi.report(id, reason, note.trim() ? note.trim().slice(0, 300) : null);
      setState('sent');
    } catch {
      setState('error');
    }
  };

  return (
    <View style={[styles.backdrop, { backgroundColor: colors.scrim }]}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel={t('mentor.reportSheet.cancel')}
        testID="mentor-report-backdrop"
      />
      <View style={[styles.card, { backgroundColor: colors.surface }]} testID="mentor-report-sheet">
        {state === 'sent' ? (
          <>
            <Text style={[type.body, { color: colors.ink, textAlign: 'center' }]} testID="mentor-report-sent">
              {t('mentor.reportSheet.sent')}
            </Text>
            <PrimaryButton
              label={t('mentor.helplines.close')}
              onPress={() => router.back()}
              testID="mentor-report-done"
            />
          </>
        ) : (
          <>
            <Text style={[styles.title, { color: colors.ink }]}>{t('mentor.reportSheet.title')}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentor.reportSheet.body')}</Text>

            <View style={styles.chips}>
              {REASONS.map(({ key, label }) => {
                const selected = reason === key;
                return (
                  <PressKey
                    key={key}
                    onPress={() => setReason(key)}
                    edge={selected ? colors.accentEdge : colors.edgeSurface}
                    travel={3}
                    radius={radius.pill}
                    accessibilityState={{ selected }}
                    style={[
                      styles.chip,
                      { backgroundColor: selected ? colors.accent : colors.surfaceAlt },
                    ]}
                    testID={`report-reason-${key}`}
                  >
                    <Text style={[type.label, { color: selected ? colors.onAccent : colors.ink }]}>
                      {t(label)}
                    </Text>
                  </PressKey>
                );
              })}
            </View>

            <TextInput
              value={note}
              onChangeText={setNote}
              maxLength={300}
              multiline
              placeholder={t('mentor.reportSheet.notePlaceholder')}
              placeholderTextColor={colors.inkMuted}
              style={[styles.note, { backgroundColor: colors.surfaceAlt, color: colors.ink }]}
              testID="report-note"
            />

            {state === 'error' ? (
              <Text style={[type.caption, { color: colors.danger }]}>{t('mentor.reportSheet.error')}</Text>
            ) : null}

            <PrimaryButton
              label={t('mentor.reportSheet.submit')}
              onPress={() => void submit()}
              disabled={!reason}
              loading={state === 'sending'}
              testID="report-submit"
            />
            <PrimaryButton
              label={t('mentor.reportSheet.cancel')}
              variant="link"
              onPress={close}
              disabled={state === 'sending'}
              testID="report-cancel"
            />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.md,
  },
  card: {
    alignSelf: 'stretch',
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
    maxWidth: 420,
  },
  title: { fontFamily: font.sansHeavy, fontSize: 20, lineHeight: 26 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { paddingHorizontal: space.md, paddingVertical: space.xs },
  note: {
    borderRadius: radius.md,
    padding: space.sm,
    minHeight: 72,
    textAlignVertical: 'top',
  },
});

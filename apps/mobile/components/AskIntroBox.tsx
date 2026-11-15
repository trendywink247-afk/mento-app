import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { PressKey } from '@/components/motion/PressKey';
import { initialIntro, introDraft } from '@/lib/askIntroDraft';
import { useI18n } from '@/lib/i18n';
import { ASK_INTRO_MAX } from '@/lib/startChat';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/**
 * "What would you like to talk about?" — shown before an ask on an exam road (DECISIONS §N.2),
 * so a mentor never receives words the member did not see. Prefilled with the member's own drafted
 * question, or the plain line; the member can keep it, change it, or write their own. Inline (no
 * RN <Modal>: blank on Android new arch), still (T&S #11: no arrival, no haptic), and nothing is
 * sent until they press Send. The crisis scan reads this text on the server like any message.
 */
export function AskIntroBox({
  drafted,
  onSend,
  onCancel,
  testID = 'ask-intro',
}: {
  drafted?: string | null;
  onSend: (text: string) => void;
  onCancel: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const fallback = t('askIntro.defaultLine');
  const [text, setText] = useState(() => initialIntro(drafted, fallback));
  const draft = introDraft(text);
  const isDefault = text.trim() === fallback;

  return (
    <View
      style={[styles.wrap, { backgroundColor: colors.surface, borderColor: colors.border }]}
      testID={testID}
    >
      <Text style={[type.label, { color: colors.ink }]} accessibilityRole="header">
        {t('askIntro.title')}
      </Text>
      <Text style={[type.caption, { color: colors.inkMuted }]}>{t('askIntro.hint')}</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        maxLength={ASK_INTRO_MAX}
        autoFocus
        accessibilityLabel={t('askIntro.fieldA11y')}
        placeholder={t('askIntro.placeholder')}
        placeholderTextColor={colors.inkMuted}
        style={[styles.field, { backgroundColor: colors.bg, borderColor: colors.border, color: colors.ink }]}
        testID={`${testID}-field`}
      />
      <View style={styles.meta}>
        {isDefault ? (
          <View />
        ) : (
          <PressKey
            onPress={() => setText(fallback)}
            edge={colors.edgeSurface}
            radius={radius.pill}
            accessibilityRole="button"
            accessibilityLabel={t('askIntro.useDefault')}
            testID={`${testID}-default`}
            style={[styles.chip, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
          >
            <Text style={[type.caption, { color: colors.ink }]}>{t('askIntro.useDefault')}</Text>
          </PressKey>
        )}
        <Text
          style={[type.caption, { color: draft.tooLong ? colors.danger : colors.inkMuted }]}
          accessibilityLabel={t('askIntro.leftA11y', { n: Math.max(0, draft.left) })}
          testID={`${testID}-count`}
        >
          {`${text.trim().length}/${ASK_INTRO_MAX}`}
        </Text>
      </View>
      <View style={styles.row}>
        <PressKey
          onPress={() => draft.canSend && onSend(text.trim())}
          edge={colors.accentEdge}
          radius={radius.md}
          intent="commit"
          disabled={!draft.canSend}
          accessibilityLabel={t('askIntro.send')}
          accessibilityState={{ disabled: !draft.canSend }}
          style={[styles.button, { backgroundColor: colors.accent, opacity: draft.canSend ? 1 : 0.5 }]}
          containerStyle={{ flex: 1 }}
          testID={`${testID}-send`}
        >
          <Text style={[type.label, { color: colors.onAccent }]}>{t('askIntro.send')}</Text>
        </PressKey>
        <PressKey
          onPress={onCancel}
          edge={colors.edgeSurface}
          radius={radius.md}
          accessibilityLabel={t('askIntro.cancel')}
          style={[styles.button, { backgroundColor: colors.surfaceAlt }]}
          containerStyle={{ flex: 1 }}
          testID={`${testID}-cancel`}
        >
          <Text style={[type.label, { color: colors.ink }]}>{t('askIntro.cancel')}</Text>
        </PressKey>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm, padding: space.md, borderWidth: 1, borderRadius: radius.lg },
  field: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 96,
    textAlignVertical: 'top',
    ...type.body,
  },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  chip: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  row: { flexDirection: 'row', gap: space.sm },
  button: { padding: space.sm, alignItems: 'center' },
});

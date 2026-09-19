import { Ionicons } from '@expo/vector-icons';
import { forwardRef } from 'react';
import { Platform, StyleSheet, Text, TextInput, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { COMPANION_NAME_MAX, companionNameSuggestionKey } from '@/lib/companionName';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, type } from '@/theme/tokens';

/** The field's height — one compact pillow row (the email step's field look, with its
 * label carried inside so the companion pick keeps the board's A03 proportions). */
export const COMPANION_NAME_FIELD_H = 56;

type Props = {
  value: string;
  onChangeText: (v: string) => void;
  /** The chosen animal — the placeholder suggests a name for it ("Maybe Miso"). */
  animal: string | null | undefined;
  invalid?: boolean;
  onSubmitEditing?: () => void;
  autoFocus?: boolean;
  testID?: string;
};

/** "Name your companion (optional)" — the member's own name for their companion, shown
 * back to them only. Used on the companion pick (board A03) and in Profile's edit.
 * An invalid name turns the edge to danger and the caller shows one still line (T&S #11:
 * nothing shakes). */
export const CompanionNameField = forwardRef<TextInput, Props>(function CompanionNameField(
  { value, onChangeText, animal, invalid = false, onSubmitEditing, autoFocus, testID = 'companion-name-input' },
  ref,
) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <EdgeSurface
      edge={invalid ? colors.danger : colors.edgeSurface}
      travel={4}
      radius={radius.md}
      style={[
        styles.field,
        { backgroundColor: colors.surface, borderColor: invalid ? colors.danger : colors.border },
      ]}
    >
      <Ionicons name="paw-outline" size={20} color={colors.accent} />
      <View style={styles.column}>
        <Text style={[styles.label, { color: colors.ink }]} numberOfLines={1}>
          {t('onboarding.companionName.label')}{' '}
          <Text style={{ fontFamily: font.sans, color: colors.inkMuted }}>{t('onboarding.companionName.optional')}</Text>
        </Text>
        <TextInput
          ref={ref}
          style={[styles.input, { color: colors.ink }]}
          value={value}
          onChangeText={onChangeText}
          placeholder={t(companionNameSuggestionKey(animal))}
          placeholderTextColor={colors.inkMuted}
          maxLength={COMPANION_NAME_MAX}
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="done"
          onSubmitEditing={onSubmitEditing}
          autoFocus={autoFocus}
          accessibilityLabel={t('onboarding.companionName.a11y')}
          testID={testID}
        />
      </View>
    </EdgeSurface>
  );
});

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: COMPANION_NAME_FIELD_H,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  column: { flex: 1, minWidth: 0, justifyContent: 'center' },
  label: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16 },
  input: {
    ...type.body,
    height: 26,
    paddingVertical: 0,
    // The pillow's edge is the field; the browser's focus rectangle inside it is noise.
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
});

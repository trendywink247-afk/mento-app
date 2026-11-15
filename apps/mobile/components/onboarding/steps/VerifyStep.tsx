import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Entrance } from '@/components/motion/Entrance';
import { StepScaffold } from '@/components/onboarding/StepScaffold';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

/** Verification at signup (DECISIONS R.11) — a STUB. It appears only when the server's
 * `signup_verification_required` is on (off today) and verifies nothing yet: one line and
 * Continue. The real check is decided later. */
export function VerifyStep({ onNext }: { onNext: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <StepScaffold
      footerIndex={2}
      footer={<PrimaryButton label={t('common.continue')} shape="key" trailing="arrow" onPress={onNext} testID="continue" />}
    >
      <View style={styles.head}>
        <Entrance index={0}>
          <Text style={[type.displayHeadline, { color: colors.ink }]} accessibilityRole="header">
            {t('onboarding.verify.headline')}
          </Text>
        </Entrance>
        <Entrance index={1}>
          <Text style={[type.body, { color: colors.inkMuted }]}>{t('onboarding.verify.sub')}</Text>
        </Entrance>
      </View>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  head: { gap: space.xs },
});

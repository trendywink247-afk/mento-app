/**
 * JourneyHeader — the one header every first-run step shares (board A16/A17/A18): the
 * round pillow back key on the left, the step dots in the middle, an empty 44 on the
 * right so the dots stay centred. It has NO arrival animation — it is simply already
 * there from step to step, which is what reads as one continuous flow.
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space } from '@/theme/tokens';

const KEY = 44;

type Props = {
  /** Omit to hide the back key (forward-only steps). */
  onBack?: () => void;
  /** 1-based position and count; omit to hide the dots (role fork, connecting). */
  progress?: { index: number; total: number };
};

export function JourneyHeader({ onBack, progress }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();

  return (
    <View style={styles.row}>
      {onBack ? (
        <PressKey
          onPress={onBack}
          edge={colors.edgeSurface}
          travel={4}
          radius={radius.pill}
          accessibilityLabel={t('common.goBack')}
          testID="back"
          style={[styles.key, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </PressKey>
      ) : (
        <View style={styles.spacer} />
      )}

      {progress ? (
        <View
          style={styles.dots}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t('onboarding.stepOf', { n: progress.index, total: progress.total })}
        >
          {Array.from({ length: progress.total }, (_, i) => {
            const n = i + 1;
            const current = n === progress.index;
            return (
              <View
                key={n}
                style={[
                  styles.dot,
                  current && styles.dotCurrent,
                  { backgroundColor: n <= progress.index ? colors.accent : colors.dotIdle },
                ]}
              />
            );
          })}
        </View>
      ) : null}

      <View style={styles.spacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // The key is 44 + its 4px edge; the row keeps that height with or without a key so
    // the content below never jumps between steps.
    minHeight: KEY + 4,
    paddingHorizontal: space.lg,
  },
  key: {
    width: KEY,
    height: KEY,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  spacer: { width: KEY, height: KEY },
  dots: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  dotCurrent: { width: 24 },
});

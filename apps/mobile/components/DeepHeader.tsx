/**
 * DeepHeader — the top of a deeper page (board A25 / A26 / A28…): a round white pillow
 * back key that is simply there, and the page's title + quiet line arriving from the side.
 */
import { Ionicons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { DeepArrival } from '@/components/motion/DeepArrival';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

export function BackKey({ onPress, label, testID = 'back' }: { onPress: () => void; label?: string; testID?: string }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <PressKey
      onPress={onPress}
      edge={colors.edgeSurface}
      radius={radius.pill}
      accessibilityLabel={label ?? t('common.goBack')}
      testID={testID}
      style={[styles.back, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Ionicons name="chevron-back" size={22} color={colors.ink} />
    </PressKey>
  );
}

export function DeepHeader({
  title,
  sub,
  onBack,
  backLabel,
  right,
}: {
  title: string;
  sub?: string;
  onBack: () => void;
  backLabel?: string;
  right?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <BackKey onPress={onBack} label={backLabel} />
      <DeepArrival style={styles.titles}>
        <Text style={[type.pageTitle, { color: colors.ink }]} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {sub ? (
          <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </DeepArrival>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 50, paddingHorizontal: space.md, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  titles: { flex: 1, minWidth: 0 },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

/**
 * Standard screen chrome: safe-area, optional back header, scrollable body, and a
 * pinned footer for CTAs. Consumes the theme so the back affordance picks up the accent.
 */
export function Screen({
  children,
  footer,
  onBack,
  scroll = false,
  bg = 'cream',
}: {
  children: ReactNode;
  footer?: ReactNode;
  onBack?: () => void;
  scroll?: boolean;
  /** 'lavender' = the mockups' "ritual" screens (companion, reflection, coffee, PIN). */
  bg?: 'cream' | 'lavender';
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const Body = scroll ? ScrollView : View;
  const bodyProps = scroll
    ? { contentContainerStyle: styles.scrollContent, showsVerticalScrollIndicator: false }
    : { style: styles.body };
  const lavender = bg === 'lavender';

  return (
    <SafeAreaView
      // Cream = the one sky shows through (components/motion/SkyGround.tsx).
      style={[styles.safe, lavender && { backgroundColor: colors.bgLavender }]}
      edges={['top', 'bottom']}
    >
      {onBack ? (
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={t('common.goBack')}
            testID="back"
            // Ritual screens float the chevron in a white circle (mockup #58).
            style={lavender && [styles.backCircle, { backgroundColor: colors.surface }]}
          >
            <Ionicons name="chevron-back" size={26} color={lavender ? colors.accent : colors.ink} />
          </Pressable>
        </View>
      ) : null}
      <Body {...(bodyProps as object)}>{children}</Body>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.xs },
  backCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  body: { flex: 1, paddingHorizontal: space.lg, paddingTop: space.sm },
  scrollContent: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg },
  footer: { paddingHorizontal: space.lg, paddingBottom: space.md, paddingTop: space.sm, gap: space.sm },
});

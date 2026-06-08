import { Ionicons } from '@expo/vector-icons';
import { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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
}: {
  children: ReactNode;
  footer?: ReactNode;
  onBack?: () => void;
  scroll?: boolean;
}) {
  const { colors } = useTheme();
  const Body = scroll ? ScrollView : View;
  const bodyProps = scroll
    ? { contentContainerStyle: styles.scrollContent, showsVerticalScrollIndicator: false }
    : { style: styles.body };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      {onBack ? (
        <View style={styles.header}>
          <Pressable
            onPress={onBack}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            testID="back"
          >
            <Ionicons name="chevron-back" size={26} color={colors.ink} />
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
  body: { flex: 1, paddingHorizontal: space.lg, paddingTop: space.sm },
  scrollContent: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg },
  footer: { paddingHorizontal: space.lg, paddingBottom: space.md, paddingTop: space.sm, gap: space.sm },
});

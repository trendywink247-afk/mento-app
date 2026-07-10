/**
 * StepScaffold — the body/footer chrome for one step inside the onboarding journey.
 * Mirrors components/Screen.tsx minus the SafeAreaView and back header (those live
 * once at the journey level so the ambient background and chevron never remount).
 * Transparent by design: steps render over the journey's persistent background.
 */
import { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { space } from '@/theme/tokens';

export function StepScaffold({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scrollContent: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg },
  footer: {
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
    paddingTop: space.sm,
    gap: space.sm,
  },
});

/**
 * StepScaffold — the body/footer chrome for one step inside the onboarding journey.
 * Mirrors components/Screen.tsx minus the SafeAreaView and back header (those live
 * once at the journey level so the ambient background and chevron never remount).
 * Transparent by design: steps render over the journey's persistent background.
 */
import { ReactNode, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { space } from '@/theme/tokens';

export function StepScaffold({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  // A step should never bounce/scroll when its content fits — that idle rubber-band
  // is the "annoying scroll" complaint. We keep the ScrollView (some steps genuinely
  // overflow: ReadyStep, CompanionStep, ConnectingStep's reduced-motion list, and
  // EmailStep needs keyboard avoidance) but only ENABLE scrolling once measured
  // content actually exceeds the viewport. Until then it's a static, non-bouncing view.
  const [viewportH, setViewportH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const scrollable = contentH > viewportH + 1;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollable}
        bounces={false}
        alwaysBounceVertical={false}
        overScrollMode="never"
        onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
        onContentSizeChange={(_w, h) => setContentH(h)}
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
    paddingTop: space.xs,
    gap: space.xs,
  },
});

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Entrance } from '@/components/motion/Entrance';
import { StepScaffold } from '@/components/onboarding/StepScaffold';
import { capture } from '@/lib/analytics';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { clearDraft, getDraft } from '@/lib/onboardingDraft';
import { getSessionToken, saveSession } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

/** Mentor branch terminal step: mint the anonymous session (no companion, NO
 * match), then hand off to Mentor Home. Onboards at most once — a session left
 * by an earlier attempt is reused. Error state goes still (no shake), Retry only. */
export function HandoffStep({
  active,
  onInvalidDraft,
  onDone,
}: {
  active: boolean;
  onInvalidDraft: () => void;
  onDone: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  // Gates only the automatic mount-triggered run — the Retry button calls
  // run() directly on purpose, bypassing this latch.
  const startedRef = useRef(false);
  // Unmount guard: a late network resolution must never navigate or set state
  // on an instance the user has already backed out of.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const run = useCallback(async () => {
    setError(null);
    const draft = getDraft();
    if (!draft.dob) {
      onInvalidDraft();
      return;
    }
    try {
      if (!(await getSessionToken())) {
        const onboarding = await api.startOnboarding({ dob: draft.dob, email: draft.email ?? null });
        await saveSession(onboarding.session_token, onboarding.stream_token, onboarding.user);
        capture('onboarding_completed');
      }
      if (!mountedRef.current) return;
      clearDraft();
      onDone();
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof ApiError ? e.message : t('common.networkError'));
    }
  }, [onInvalidDraft, onDone, t]);

  useEffect(() => {
    if (active && !startedRef.current) {
      startedRef.current = true;
      void run();
    }
  }, [active, run]);

  return (
    <StepScaffold
      footer={
        error ? (
          <PrimaryButton label={t('connecting.tryAgain')} tone="ink" onPress={() => void run()} testID="retry" />
        ) : undefined
      }
    >
      <Entrance index={0}>
        <View style={styles.zone} testID="handoff">
          <Text style={[styles.headline, { color: colors.ink }]} accessibilityRole="header">
            {error ? t('connecting.headlineError') : t('onboarding.handoff.headline')}
          </Text>
          <Text style={[type.body, styles.sub, { color: colors.inkMuted }]}>
            {error ?? t('onboarding.handoff.sub')}
          </Text>
          {!error ? <ActivityIndicator color={colors.accent} style={styles.spinner} /> : null}
        </View>
      </Entrance>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  zone: { alignItems: 'center', marginTop: space.xl * 2, paddingHorizontal: space.sm },
  headline: {
    ...type.displayHeadline,
    textAlign: 'center',
    marginBottom: space.md,
  },
  sub: { textAlign: 'center' },
  spinner: { marginTop: space.xl },
});

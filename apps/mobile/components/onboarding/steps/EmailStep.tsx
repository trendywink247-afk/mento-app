import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Companion, type CompanionTrigger } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { Entrance } from '@/components/motion/Entrance';
import { useBreathing } from '@/components/motion/useBreathing';
import { StepScaffold } from '@/components/onboarding/StepScaffold';
import { capture } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';
import { getDraft, setDraft } from '@/lib/onboardingDraft';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Board A17: the companion is 116 tall and its feet rest 46 inside the card's top edge. */
const COMPANION_SIZE = 116;
const FEET_INSIDE = 46;

/** Optional email — board A17: "Optional, but helpful.", a warm card with the labelled
 * field and the honest reason line, the companion keeping you company on the card's
 * corner, and Skip / Continue side by side at equal size — skipping is never the lesser
 * choice. Both exit identically. The keyboard is dismissed before the step transition so
 * the hand-over never fights it. */
export function EmailStep({ onNext }: { onNext: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const breathing = useBreathing();
  const [email, setEmail] = useState(() => getDraft().email ?? '');
  const valid = email.length === 0 || EMAIL_RE.test(email);
  const animal = (getDraft().companionAnimal as CompanionAnimal | null) ?? null;
  // "Optional, but helpful" — the companion tilts in, curious about you (once, on arrival).
  const [curious, setCurious] = useState<CompanionTrigger>(null);
  useEffect(() => {
    if (!reduced) setCurious({ kind: 'curious', n: 1 });
  }, [reduced]);

  const next = (withEmail: boolean) => {
    setDraft({ email: withEmail && email ? email.trim() : null });
    // Whether the step was skipped — never the address itself.
    capture('onboarding_email_step', { skipped: !(withEmail && email) });
    Keyboard.dismiss();
    onNext();
  };

  return (
    <StepScaffold
      footerIndex={4}
      footer={
        <>
          <View style={styles.keys}>
            <View style={styles.keyCell}>
              <PrimaryButton
                label={t('onboarding.email.skip')}
                variant="surface"
                shape="key"
                onPress={() => next(false)}
                testID="skip"
              />
            </View>
            <View style={styles.keyCell}>
              <PrimaryButton
                label={t('common.continue')}
                shape="key"
                trailing="arrow"
                onPress={() => next(true)}
                disabled={email.length > 0 && !valid}
                testID="continue"
              />
            </View>
          </View>
          <Entrance index={5}>
            <Text style={[type.caption, styles.footnote, { color: colors.inkMuted }]}>
              {t('onboarding.email.skipFine')}
            </Text>
          </Entrance>
        </>
      }
    >
      <View style={styles.head}>
        <Entrance index={0}>
          <Text style={[type.displayHeadline, { color: colors.ink }]} accessibilityRole="header">
            {t('onboarding.email.headline')}
            <Text style={{ color: colors.accent }}>{t('onboarding.email.headlineAccent')}</Text>
          </Text>
        </Entrance>
        <Entrance index={1}>
          <Text style={[type.body, { color: colors.inkMuted }]}>{t('onboarding.email.sub')}</Text>
        </Entrance>
      </View>

      <View style={styles.grow} />

      <View style={styles.cardZone}>
        <EdgeSurface
          edge={colors.edgeAlt}
          travel={3}
          radius={radius.lg}
          style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
        >
          {/* The little shadow the companion stands on. */}
          <View style={[styles.shelf, { backgroundColor: colors.edgeSurface }]} />

          <Entrance index={2} style={styles.fieldBlock}>
            <Text style={[type.label, { color: colors.ink }]}>
              {t('onboarding.email.label')}{' '}
              <Text style={{ fontFamily: font.sans, color: colors.inkMuted }}>{t('onboarding.email.optional')}</Text>
            </Text>
            <EdgeSurface
              edge={valid ? colors.edgeSurface : colors.danger}
              travel={4}
              radius={radius.md}
              style={[
                styles.field,
                { backgroundColor: colors.surface, borderColor: valid ? colors.border : colors.danger },
              ]}
            >
              <Ionicons name="mail-outline" size={22} color={colors.accent} />
              <TextInput
                style={[styles.input, { color: colors.ink }]}
                placeholder={t('onboarding.email.placeholder')}
                placeholderTextColor={colors.inkMuted}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                inputMode="email"
                autoCorrect={false}
                value={email}
                onChangeText={setEmail}
                accessibilityLabel={t('onboarding.email.inputA11y')}
                testID="email-input"
              />
            </EdgeSurface>
            {/* An error state is still: plain text, nothing shakes (T&S #11). */}
            {!valid ? (
              <Text style={[type.caption, { color: colors.danger }]}>{t('onboarding.email.invalid')}</Text>
            ) : null}
          </Entrance>

          <Entrance index={3} style={styles.reason}>
            <View style={styles.lock}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.accent} />
            </View>
            <Text style={[type.note, styles.reasonText, { color: colors.inkMuted }]}>
              {t('onboarding.email.privacy')}
            </Text>
          </Entrance>
        </EdgeSurface>

        {/* Drawn AFTER the card: the companion stands in front of its top-right corner. */}
        <View
          style={styles.companion}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('onboarding.email.companionA11y')}
          pointerEvents="none"
        >
          <Animated.View style={[styles.originBottom, breathing]}>
            <Companion animal={animal} size={COMPANION_SIZE} trigger={curious} awake />
          </Animated.View>
        </View>
      </View>

      <View style={styles.grow} />
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  head: { gap: space.sm },
  grow: { flexGrow: 1, minHeight: space.md },
  // Room above the card for the part of the companion that stands clear of it.
  cardZone: { paddingTop: COMPANION_SIZE - FEET_INSIDE },
  card: { padding: space.md, gap: 12, borderWidth: 1 },
  shelf: { position: 'absolute', right: 28, top: 36, width: 68, height: 12, borderRadius: radius.pill },
  companion: { position: 'absolute', right: space.xs, top: 0, width: COMPANION_SIZE, height: COMPANION_SIZE },
  originBottom: { transformOrigin: 'bottom' },
  fieldBlock: { gap: 6 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 58,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  input: { flex: 1, minWidth: 0, height: 44, ...type.body },
  reason: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingBottom: 2 },
  lock: { height: 20, justifyContent: 'center' },
  reasonText: { flex: 1 },
  keys: { flexDirection: 'row', gap: 12 },
  keyCell: { flex: 1 },
  footnote: { textAlign: 'center', marginTop: space.sm },
});

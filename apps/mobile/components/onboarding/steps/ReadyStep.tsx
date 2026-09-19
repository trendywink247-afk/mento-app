import { Ionicons } from '@expo/vector-icons';
import { Fragment } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Entrance } from '@/components/motion/Entrance';
import { useBreathing } from '@/components/motion/useBreathing';
import { StepScaffold } from '@/components/onboarding/StepScaffold';
import { Companion } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { useI18n, type TKey } from '@/lib/i18n';
import { getDraft } from '@/lib/onboardingDraft';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLOR_LABELS } from '@/theme/companion';
import type { CompanionColor } from '@/theme/companion';
import { font, radius, space, type } from '@/theme/tokens';

const AFFIRMATIONS: { icon: keyof typeof Ionicons.glyphMap; text: TKey }[] = [
  { icon: 'trophy-outline', text: 'onboarding.ready.affirm1' },
  { icon: 'book-outline', text: 'onboarding.ready.affirm2' },
  { icon: 'swap-horizontal-outline', text: 'onboarding.ready.affirm3' },
  { icon: 'flag-outline', text: 'onboarding.ready.affirm4' },
];

/** "Mento space ready!" confirmation (mockup #59; body unchanged from the old route). */
export function ReadyStep({ onNext }: { onNext: () => void }) {
  const { colors, companionColor } = useTheme();
  const { t } = useI18n();
  const draft = getDraft();
  // Companion is optional in the draft (Surprise Me edge / direct deep link): fall back
  // gracefully rather than blocking the path to a conversation.
  const animal = (draft.companionAnimal as CompanionAnimal | null) ?? 'Panda';
  const colourLabel =
    COMPANION_COLOR_LABELS[(draft.companionColour as CompanionColor | null) ?? companionColor];
  // The chosen companion breathes in the arch; the panda choice gets the full rig.
  const breathing = useBreathing();

  return (
    <StepScaffold
      footerIndex={4}
      footer={
        <>
          <PrimaryButton
            label={t('onboarding.ready.enter')}
            trailing="chevron"
            onPress={onNext}
            testID="enter"
          />
          <View style={styles.lockRow}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.inkMuted} />
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              {t('onboarding.ready.changeLater')}
            </Text>
          </View>
        </>
      }
    >
      <Entrance index={0}>
        <View style={styles.head}>
          <IconBadge icon="checkmark" size={56} />
          <Text style={[styles.headline, { color: colors.ink }]} accessibilityRole="header">
            {t('onboarding.ready.headline')}
          </Text>
          <Text style={[type.body, styles.center, { color: colors.inkMuted }]}>
            {t('onboarding.ready.sub')}
          </Text>
        </View>
      </Entrance>

      <Entrance index={1}>
      <View style={styles.companionZone}>
        <View style={[styles.arch, { backgroundColor: colors.accentTint }]}>
          <Animated.View style={breathing}>
            {/* Tap your new companion — it acknowledges you. */}
            <Companion animal={animal} size={120} interactive awake />
          </Animated.View>
        </View>
        <Text style={[type.bodySemi, styles.center, { color: colors.ink }]}>{t('onboarding.ready.youChose')}</Text>
        <Text style={[styles.companionName, { color: colors.ink }]}>
          {colourLabel} {animal}
        </Text>
        <Text style={[type.body, styles.center, { color: colors.inkMuted }]}>
          {t('onboarding.ready.asCompanion')}
        </Text>
      </View>
      </Entrance>

      <Entrance index={2}>
      <View style={styles.sparkleRow}>
        <View style={[styles.hairline, { backgroundColor: colors.border }]} />
        <Ionicons name="sparkles-outline" size={16} color={colors.accentSoft} />
        <View style={[styles.hairline, { backgroundColor: colors.border }]} />
      </View>

      <Text style={[styles.sectionTitle, { color: colors.ink }]}>
        {t('onboarding.ready.gentleTitle')}
      </Text>
      <Text style={[type.body, styles.center, { color: colors.inkMuted }]}>
        {t('onboarding.ready.gentleSub')}
      </Text>
      </Entrance>

      <Entrance index={3}>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <View style={styles.cardHead}>
          <Text style={[type.label, { color: colors.accent, flex: 1 }]}>
            {t('onboarding.ready.affirmTitle')}
          </Text>
          <Ionicons name="heart-outline" size={18} color={colors.accent} />
        </View>
        {AFFIRMATIONS.map((a, i) => (
          <Fragment key={a.icon}>
            {i > 0 ? <View style={[styles.rowDivider, { backgroundColor: colors.border }]} /> : null}
            <View style={styles.row}>
              <IconBadge icon={a.icon} size={40} />
              <Text style={[type.body, { color: colors.ink, flex: 1 }]}>{t(a.text)}</Text>
            </View>
          </Fragment>
        ))}
      </View>
      </Entrance>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  head: { alignItems: 'center', gap: space.sm, marginTop: space.sm, marginBottom: space.md },
  headline: { ...type.displayHeadline, textAlign: 'center' },
  center: { textAlign: 'center' },
  companionZone: { alignItems: 'center', gap: space.xs, marginBottom: space.md },
  arch: {
    width: 184,
    height: 150,
    borderTopLeftRadius: 100,
    borderTopRightRadius: 100,
    borderBottomLeftRadius: radius.md,
    borderBottomRightRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingBottom: space.md,
    marginBottom: space.xs,
  },
  companionName: { fontFamily: font.serifBold, fontSize: 26, lineHeight: 34, textAlign: 'center' },
  sparkleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginVertical: space.md,
  },
  hairline: { flex: 1, height: 1 },
  sectionTitle: {
    fontFamily: font.serifBold,
    fontSize: 24,
    lineHeight: 32,
    textAlign: 'center',
    marginBottom: space.sm,
  },
  card: { borderRadius: radius.lg, padding: space.md, marginTop: space.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', marginBottom: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm },
  rowDivider: { height: 1, marginLeft: 40 + space.md },
  lockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    marginTop: space.xs,
  },
});

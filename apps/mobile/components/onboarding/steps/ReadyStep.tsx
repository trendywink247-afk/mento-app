import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import { PromiseRow } from '@/components/PromiseRow';
import { Companion } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { Entrance } from '@/components/motion/Entrance';
import { GroundGlow } from '@/components/motion/GroundGlow';
import { Stage } from '@/components/motion/Stage';
import { useBreathing } from '@/components/motion/useBreathing';
import { StepScaffold } from '@/components/onboarding/StepScaffold';
import { useI18n } from '@/lib/i18n';
import { getDraft } from '@/lib/onboardingDraft';
import { useFrameSize } from '@/lib/useFrameSize';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLOR_LABELS } from '@/theme/companion';
import type { CompanionColor } from '@/theme/companion';
import { font, radius, space, type } from '@/theme/tokens';

/** Board A18: a 216 stage; the companion is 168 tall and stands 28 above its bottom edge,
 * on a glow that starts 52 in from each side and sits 22 up. */
const STAGE = 216;
const STAGE_MIN = 144;
const COMPACT_BELOW = 780;

/** "Your Mento space is ready." — board A18: the chosen companion large on a round stage
 * (accent-tint disc, one slow dotted ring, ground glow), its name on a pill, the three
 * promises, and "Enter My Space". */
export function ReadyStep({ onNext }: { onNext: () => void }) {
  const { colors, companionColor } = useTheme();
  const { t } = useI18n();
  const { height } = useFrameSize();
  const draft = getDraft();
  // Companion is optional in the draft (Surprise Me edge / direct deep link): fall back
  // gracefully rather than blocking the path to a conversation.
  const animal = (draft.companionAnimal as CompanionAnimal | null) ?? 'Panda';
  const colourLabel =
    COMPANION_COLOR_LABELS[(draft.companionColour as CompanionColor | null) ?? companionColor];
  const breathing = useBreathing();
  const stage = height < COMPACT_BELOW ? STAGE_MIN : STAGE;
  const k = stage / STAGE;

  return (
    <StepScaffold
      footerIndex={4}
      footer={
        <>
          <PrimaryButton
            label={t('onboarding.ready.enter')}
            shape="key"
            trailing="arrow"
            onPress={onNext}
            testID="enter"
          />
          <Text style={[type.caption, styles.changeLater, { color: colors.inkMuted }]}>
            {t('onboarding.ready.changeLater')}
          </Text>
        </>
      }
    >
      <View style={styles.head}>
        <Entrance index={0}>
          <Text style={[type.displayHeadline, styles.center, { color: colors.ink }]} accessibilityRole="header">
            {t('onboarding.ready.headline')}
            <Text style={{ color: colors.accent }}>{t('onboarding.ready.headlineAccent')}</Text>
          </Text>
        </Entrance>
        <Entrance index={1}>
          <Text style={[type.body, styles.center, { color: colors.inkMuted }]}>{t('onboarding.ready.sub')}</Text>
        </Entrance>
      </View>

      {/* The stage has no arrival: it is simply already there. */}
      <View style={[styles.stage, { width: stage, height: stage }]}>
        <Stage size={stage} rings={1} />
        <View style={[styles.glow, { left: 52 * k, bottom: 22 * k }]}>
          <GroundGlow width={stage - 104 * k} height={20 * k} />
        </View>
        <View style={[styles.companion, { bottom: 28 * k }]}>
          <Animated.View style={[styles.originBottom, breathing]}>
            {/* Tap your new companion — it acknowledges you. Where a living loop exists
              * (web, Cat) it breathes, blinks and sways on its own. */}
            <Companion animal={animal} size={168 * k} interactive awake living />
          </Animated.View>
        </View>
      </View>

      <Entrance index={2} style={styles.pillWrap}>
        <EdgeSurface
          edge={colors.edgeSurface}
          travel={3}
          radius={radius.pill}
          style={[styles.pill, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={[styles.pillDot, { backgroundColor: colors.accent }]} />
          <Text style={[type.caption, { color: colors.inkMuted }]}>
            <Text style={{ fontFamily: font.sansBold, color: colors.ink }}>
              {colourLabel} {animal}
            </Text>
            {t('onboarding.ready.asCompanion')}
          </Text>
        </EdgeSurface>
      </Entrance>

      <View style={styles.grow} />

      <Entrance index={3}>
        <EdgeSurface
          edge={colors.edgeSurface}
          travel={3}
          radius={radius.lg}
          style={[styles.promises, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <PromiseRow
            icon="person-outline"
            tone="green"
            title={t('onboarding.ready.promise1')}
            body={t('onboarding.ready.promise1Sub')}
          />
          <PromiseRow
            icon="lock-closed-outline"
            tone="indigo"
            title={t('onboarding.ready.promise2')}
            body={t('onboarding.ready.promise2Sub')}
          />
          <PromiseRow
            icon="exit-outline"
            tone="orange"
            title={t('onboarding.ready.promise3')}
            body={t('onboarding.ready.promise3Sub')}
          />
        </EdgeSurface>
      </Entrance>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  head: { gap: space.xs },
  center: { textAlign: 'center' },
  stage: { alignSelf: 'center', marginTop: 12 },
  glow: { position: 'absolute' },
  companion: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  originBottom: { transformOrigin: 'bottom' },
  pillWrap: { alignSelf: 'center', marginTop: 12 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 32,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  pillDot: { width: 10, height: 10, borderRadius: radius.pill },
  grow: { flexGrow: 1, minHeight: 12 },
  promises: { paddingVertical: 12, paddingHorizontal: space.md, gap: 10, borderWidth: 1 },
  changeLater: { textAlign: 'center', marginTop: space.sm },
});

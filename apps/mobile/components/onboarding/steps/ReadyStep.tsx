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
import { getDraft } from '@/lib/onboardingDraft';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLOR_LABELS } from '@/theme/companion';
import type { CompanionColor } from '@/theme/companion';
import { font, radius, space, type } from '@/theme/tokens';

const AFFIRMATIONS: { icon: keyof typeof Ionicons.glyphMap; text: string }[] = [
  { icon: 'trophy-outline', text: 'This is not a place for competition.' },
  { icon: 'book-outline', text: 'Not a classroom session.' },
  { icon: 'swap-horizontal-outline', text: 'Not a material exchange platform.' },
  { icon: 'flag-outline', text: 'Not a race against others.' },
];

/** "Mento space ready!" confirmation (mockup #59; body unchanged from the old route). */
export function ReadyStep({ onNext }: { onNext: () => void }) {
  const { colors, companionColor } = useTheme();
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
      footer={
        <>
          <PrimaryButton
            label="Enter My Space"
            trailing="chevron"
            onPress={onNext}
            testID="enter"
          />
          <View style={styles.lockRow}>
            <Ionicons name="lock-closed-outline" size={14} color={colors.inkMuted} />
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              You can change your companion and theme later from Profile.
            </Text>
          </View>
        </>
      }
    >
      <Entrance index={0}>
        <View style={styles.head}>
          <IconBadge icon="checkmark" size={56} />
          <Text style={[styles.headline, { color: colors.ink }]} accessibilityRole="header">
            Mento space ready!
          </Text>
          <Text style={[type.body, styles.center, { color: colors.inkMuted }]}>
            Your space is all set. Your journey{'\n'}begins now. 💜
          </Text>
        </View>
      </Entrance>

      <Entrance index={1}>
      <View style={styles.companionZone}>
        <View style={[styles.arch, { backgroundColor: colors.accentTint }]}>
          <Animated.View style={breathing}>
            {/* Tap your new companion — it acknowledges you. */}
            <Companion animal={animal} size={120} interactive />
          </Animated.View>
        </View>
        <Text style={[type.bodySemi, styles.center, { color: colors.ink }]}>You chose</Text>
        <Text style={[styles.companionName, { color: colors.ink }]}>
          {colourLabel} {animal}
        </Text>
        <Text style={[type.body, styles.center, { color: colors.inkMuted }]}>
          as your growth companion 💜
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
        A gentle space for your growth
      </Text>
      <Text style={[type.body, styles.center, { color: colors.inkMuted }]}>
        Here, you can reflect, learn and grow with{'\n'}kindness towards yourself.
      </Text>
      </Entrance>

      <Entrance index={3}>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <View style={styles.cardHead}>
          <Text style={[type.label, { color: colors.accent, flex: 1 }]}>
            A few affirmations for your journey
          </Text>
          <Ionicons name="heart-outline" size={18} color={colors.accent} />
        </View>
        {AFFIRMATIONS.map((a, i) => (
          <Fragment key={a.icon}>
            {i > 0 ? <View style={[styles.rowDivider, { backgroundColor: colors.border }]} /> : null}
            <View style={styles.row}>
              <IconBadge icon={a.icon} size={40} />
              <Text style={[type.body, { color: colors.ink, flex: 1 }]}>{a.text}</Text>
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
  headline: { fontFamily: font.serifBold, fontSize: 30, lineHeight: 38, textAlign: 'center' },
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

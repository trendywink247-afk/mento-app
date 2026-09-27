import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { EdgeSurface } from '@/components/EdgeSurface';
import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Companion } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { Entrance } from '@/components/motion/Entrance';
import { useBreathing } from '@/components/motion/useBreathing';
import { StepScaffold } from '@/components/onboarding/StepScaffold';
import { useI18n, type TKey } from '@/lib/i18n';
import { getDraft } from '@/lib/onboardingDraft';
import { useFrameSize } from '@/lib/useFrameSize';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS } from '@/theme/companion';
import { radius, space, type, type Wash } from '@/theme/tokens';

const ROWS: { icon: keyof typeof Ionicons.glyphMap; tone: Wash; title: TKey; body: TKey }[] = [
  { icon: 'ear-outline', tone: 'green', title: 'mentorPrimer.row1Title', body: 'mentorPrimer.row1Body' },
  { icon: 'person-outline', tone: 'accent', title: 'mentorPrimer.row2Title', body: 'mentorPrimer.row2Body' },
  { icon: 'shield-checkmark-outline', tone: 'sky', title: 'mentorPrimer.row3Title', body: 'mentorPrimer.row3Body' },
  { icon: 'sync-outline', tone: 'indigo', title: 'mentorPrimer.row4Title', body: 'mentorPrimer.row4Body' },
];

/** Board A33: the companion is 92 × 106 and stands 8 into the first card's top edge. */
const PERCH = 100;
const PERCH_SINK = 8;
/** The headline keeps clear of the perch (board: a 236-wide text column). */
const HEAD_CLEAR = PERCH + space.sm;
const COMPACT_BELOW = 780;

/** Mentor branch — board A33 "Mentoring here, in plain words.": the four things to hold
 * on to, each its own pillow card, the mentor's companion perched on the first one. A
 * mentor has not picked a companion at this point of the journey, so it is the board's
 * Owl unless the draft carries one. The "not a therapist" pledge checkbox is NOT here —
 * it stays a hard gate on the application form (T&S #2). */
export function PrimerStep({
  onNext,
  animal: animalProp,
  companion = true,
}: {
  onNext: () => void;
  /** The member's own animal when the mentor path hosts the primer (lib/mentorPath). */
  animal?: CompanionAnimal | null;
  /** false on the public web page, which carries no animal art (founder rule). */
  companion?: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const breathing = useBreathing();
  const compact = useFrameSize().height < COMPACT_BELOW;
  const animal = animalProp ?? (getDraft().companionAnimal as CompanionAnimal | null) ?? 'Owl';

  return (
    <StepScaffold
      footerIndex={5}
      footer={
        <>
          <PrimaryButton
            label={t('common.continue')}
            shape="key"
            trailing="arrow"
            onPress={onNext}
            testID="primer-continue"
          />
          <Text style={[type.caption, styles.footLine, { color: colors.inkMuted }]}>{t('mentorPrimer.footer')}</Text>
        </>
      }
    >
      <Entrance index={0} style={[styles.head, !companion && styles.headWide]}>
        <Text style={[type.eyebrow, { color: COMPANION_COLORS.sage.accentEdge }]}>{t('mentorPrimer.eyebrow')}</Text>
        <Text style={[type.displayHeadline, { color: colors.ink }]} accessibilityRole="header">
          {t('mentorPrimer.headline')}
          <Text style={{ color: colors.accent }}>{t('mentorPrimer.headlineAccent')}</Text>
        </Text>
        {compact ? null : <Text style={[type.body, { color: colors.inkMuted }]}>{t('mentorPrimer.sub')}</Text>}
      </Entrance>

      <View style={[styles.rows, compact && styles.rowsCompact]}>
        {/* No arrival: the companion is simply already there (board). Drawn before the
          * cards' siblings but lifted above the first card, so it perches on its rim. */}
        {companion ? (
        <View
          style={styles.perch}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('mentorPrimer.companionA11y')}
          pointerEvents="none"
          testID="primer-companion"
        >
          <Animated.View style={[styles.originBottom, breathing]}>
            <Companion animal={animal} size={PERCH} awake />
          </Animated.View>
        </View>
        ) : null}

        {ROWS.map((row, i) => (
          <Entrance key={row.title} index={1 + i}>
            <EdgeSurface
              edge={colors.edgeSurface}
              travel={3}
              radius={radius.lg}
              style={[styles.card, compact && styles.cardCompact, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <IconBadge icon={row.icon} tone={row.tone} size={40} />
              <View style={styles.text}>
                <Text style={[type.cardTitle, { color: colors.ink }]}>{t(row.title)}</Text>
                <Text style={[type.note, { color: colors.inkMuted }]}>{t(row.body)}</Text>
              </View>
            </EdgeSurface>
          </Entrance>
        ))}
      </View>

      <View style={styles.grow} />
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  head: { gap: space.xs, paddingRight: HEAD_CLEAR },
  headWide: { paddingRight: 0 },
  rows: { marginTop: space.md, gap: 10 },
  rowsCompact: { gap: 6 },
  perch: { position: 'absolute', right: 12, top: -(PERCH - PERCH_SINK), width: PERCH, height: PERCH, zIndex: 2 },
  originBottom: { transformOrigin: 'bottom' },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  cardCompact: { paddingVertical: space.sm },
  text: { flex: 1, minWidth: 0 },
  grow: { flexGrow: 1, minHeight: space.sm },
  footLine: { textAlign: 'center', marginTop: space.sm },
});

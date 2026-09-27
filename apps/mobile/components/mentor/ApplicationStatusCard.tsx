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
import type { ListenerApplication } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS } from '@/theme/companion';
import { radius, space, type, wash } from '@/theme/tokens';

type Props = {
  state: 'review' | 'approved' | 'declined';
  application: ListenerApplication;
  animal: CompanionAnimal | null;
  /** Approved: today's rotating name (null while it loads — the row waits for it). */
  persona?: string | null;
  onRead?: () => void;
  /** Review, member flow only (Mentor Home has no Profile to go back to). */
  onBackToProfile?: () => void;
  /** Approved, member flow only. */
  onOpenHome?: () => void;
  /** The way back's words (default "Back to Profile") — a new mentor from the role fork has
   * no Profile behind them yet (lib/mentorPath `continueAsMember`). */
  backLabel?: string;
  /** No companion art (the public web page carries none — founder rule). */
  bare?: boolean;
};

/** Board A37's two status states (and the declined note that sits over a fresh form):
 * the companion standing on the status card, a chip, the headline, where the application
 * is — and, once approved, today's name and the way into Mentor Home. Data only: the
 * state is the server's, never a switch. */
export function ApplicationStatusCard({
  state,
  application,
  animal,
  persona,
  onRead,
  onBackToProfile,
  onOpenHome,
  backLabel,
  bare = false,
}: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const breathing = useBreathing();
  const mustard = COMPANION_COLORS.mustard.accentEdge;
  const sageInk = COMPANION_COLORS.sage.accentEdge;
  const who = animal ?? 'Owl';

  if (state === 'declined') {
    // The same shape as the other two states — their own companion standing on the card,
    // in its ordinary idle pose (nothing celebratory) — so a declined applicant does not
    // land on a screen that looks like a different app.
    return (
      <View testID="apply-declined">
        <View style={{ paddingTop: bare ? 0 : 92 }}>
          {bare ? null : (
            <View
              style={[styles.companion, { height: 114, left: 20 }]}
              pointerEvents="none"
              accessible
              accessibilityRole="image"
              accessibilityLabel={t('mentorApply.companionReviewA11y')}
            >
              <Animated.View style={[styles.originBottom, breathing]}>
                <Companion animal={who} size={114} awake />
              </Animated.View>
            </View>
          )}
          <Entrance index={0}>
            <EdgeSurface
              edge={colors.edgeSurface}
              style={[styles.card, { paddingTop: bare ? 18 : 28, backgroundColor: colors.surface, borderColor: colors.border }]}
              testID="mentor-status"
            >
              <Chip label={t('mentorApply.declinedChip')} bg={colors.surfaceAlt} fg={colors.ink} icon="leaf-outline" />
              <Text style={[type.cardTitle, { color: colors.ink }]}>{t('profile.declinedTitle')}</Text>
              {/* The thanks only — the cooldown is said ONCE, with its date, right under the
                  card (MentorPathFlow). */}
              <Text style={[type.note, { color: colors.inkMuted }]}>{t('mentorApplyCopy.declinedBody')}</Text>
            </EdgeSurface>
          </Entrance>
        </View>
      </View>
    );
  }

  const approved = state === 'approved';
  const lift = bare ? 0 : approved ? 108 : 92;
  const art = approved ? 132 : 114;

  return (
    <View style={styles.root} testID={approved ? 'apply-approved' : 'apply-in-review'}>
      <View style={{ paddingTop: lift }}>
        {bare ? null : (
        <View
          style={[styles.companion, { height: art, left: approved ? 18 : 20 }]}
          pointerEvents="none"
          accessible
          accessibilityRole="image"
          accessibilityLabel={t(approved ? 'mentorApply.companionApprovedA11y' : 'mentorApply.companionReviewA11y')}
        >
          <Animated.View style={[styles.originBottom, breathing]}>
            <Companion animal={who} size={art} pose={approved ? 'greet' : undefined} awake />
          </Animated.View>
        </View>
        )}
        <Entrance index={0}>
          <EdgeSurface
            edge={colors.edgeSurface}
            style={[styles.card, { paddingTop: bare ? 18 : approved ? 30 : 28, backgroundColor: colors.surface, borderColor: colors.border }]}
            testID="mentor-status"
          >
            {approved ? (
              <Chip label={t('mentorApply.approvedChip')} bg={wash.green} fg={sageInk} icon="checkmark" />
            ) : (
              <Chip label={t('mentorApply.reviewChip')} bg={wash.orange} fg={mustard} icon="time-outline" />
            )}
            <Text style={[styles.headline, { color: colors.ink }]} accessibilityRole="header">
              {approved ? t('mentorApply.approvedHeadline') : t('mentorApply.reviewHeadline')}
              <Text style={{ color: colors.accent }}>
                {approved ? t('mentorApply.approvedHeadlineAccent') : t('mentorApply.reviewHeadlineAccent')}
              </Text>
              {approved ? t('mentorApply.approvedHeadlineEnd') : null}
            </Text>
            <Text style={[type.body, { color: colors.ink }]}>
              {approved ? t('mentorApply.approvedBody') : t('mentorApply.reviewBody')}
            </Text>
            {approved ? null : <Text style={[type.note, { color: colors.inkMuted }]}>{t('mentorApply.reviewNote')}</Text>}
          </EdgeSurface>
        </Entrance>
      </View>

      {approved ? (
        <>
          <Entrance index={1}>
            <EdgeSurface edge={colors.edgeSurface} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <IconBadge icon="sync-outline" tone="indigo" size={40} />
              <View style={styles.shrink}>
                <Text style={[type.cardTitle, { color: colors.ink }]} testID="apply-today-name">
                  {persona ? t('mentorApply.todayYouAre', { name: persona }) : ' '}
                </Text>
                <Text style={[type.note, { color: colors.inkMuted }]}>{t('mentorApply.todayYouAreBody')}</Text>
              </View>
            </EdgeSurface>
          </Entrance>
          <Entrance index={2}>
            <View style={[styles.row, styles.flatRow, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <IconBadge icon="book-outline" tone="orange" size={40} />
              <View style={styles.shrink}>
                <Text style={[type.cardTitle, { color: colors.ink }]}>{t('mentorApply.readingRow')}</Text>
                <Text style={[type.note, { color: colors.inkMuted }]}>{t('mentorApply.readingRowBody')}</Text>
              </View>
            </View>
          </Entrance>
        </>
      ) : (
        <Entrance index={1}>
          <View
            style={[styles.steps, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
            accessibilityRole="list"
            accessibilityLabel={t('mentorApply.stepsA11y')}
          >
            <View style={styles.step}>
              <View style={[styles.disc, { backgroundColor: wash.green }]}>
                <Ionicons name="checkmark" size={16} color={sageInk} />
              </View>
              <Text style={[type.rowTitle, styles.grow, { color: colors.ink }]}>{t('mentorApply.stepSent')}</Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>{relativeTime(application.created_at, t)}</Text>
            </View>
            <View style={styles.step}>
              <View style={[styles.disc, styles.ring, { backgroundColor: colors.accentTint, borderColor: colors.accent }]}>
                <View style={[styles.dot, { backgroundColor: colors.accent }]} />
              </View>
              <Text style={[type.rowTitle, styles.grow, { color: colors.ink }]}>{t('mentorApply.stepReading')}</Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentorApply.stepNow')}</Text>
            </View>
            <View style={styles.step}>
              <View style={[styles.disc, styles.ring, { backgroundColor: colors.surface, borderColor: colors.edgeAlt }]} />
              <Text style={[type.rowTitle, styles.grow, { color: colors.inkMuted }]}>{t('mentorApply.stepNext')}</Text>
            </View>
          </View>
        </Entrance>
      )}

      <View style={styles.spacer} />

      <Entrance index={approved ? 3 : 2} style={styles.keys}>
        {approved ? (
          <>
            {onOpenHome ? (
              <PrimaryButton label={t('mentorApply.openHome')} shape="key" trailing="arrow" onPress={onOpenHome} testID="apply-open-home" />
            ) : null}
            <Text style={[type.caption, styles.center, { color: colors.inkMuted }]}>{t('mentorPrimer.footer')}</Text>
          </>
        ) : (
          <>
            {onRead ? (
              <PrimaryButton
                label={t('mentorApply.readMeanwhile')}
                shape="key"
                dense
                variant="surface"
                icon="book-outline"
                onPress={onRead}
                testID="apply-read"
              />
            ) : null}
            {onBackToProfile ? (
              <PrimaryButton
                label={backLabel ?? t('mentorApply.backToProfile')}
                variant="link"
                onPress={onBackToProfile}
                testID="apply-back-profile"
              />
            ) : null}
          </>
        )}
      </Entrance>
    </View>
  );
}

function Chip({ label, bg, fg, icon }: { label: string; bg: string; fg: string; icon: 'checkmark' | 'time-outline' | 'leaf-outline' }) {
  return (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={14} color={fg} />
      <Text style={[type.caption, styles.chipText, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexGrow: 1, gap: 14 },
  companion: { position: 'absolute', top: 0, zIndex: 2, alignItems: 'center', justifyContent: 'flex-end' },
  originBottom: { transformOrigin: 'bottom' },
  card: {
    paddingHorizontal: 20,
    paddingBottom: 18,
    gap: space.sm,
    alignItems: 'flex-start',
    borderWidth: 1,
  },
  plain: { paddingTop: 18 },
  headline: { fontSize: 26, lineHeight: 34, fontFamily: type.displayHeadline.fontFamily },
  chip: {
    height: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: space.sm,
    paddingRight: 12,
    borderRadius: radius.pill,
  },
  chipText: { fontFamily: type.label.fontFamily },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  flatRow: { borderRadius: radius.lg },
  shrink: { flex: 1, minWidth: 0 },
  steps: { paddingVertical: 14, paddingHorizontal: space.md, gap: 10, borderWidth: 1, borderRadius: radius.lg },
  step: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  disc: { width: 28, height: 28, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 2 },
  dot: { width: 10, height: 10, borderRadius: radius.pill },
  grow: { flex: 1, minWidth: 0 },
  spacer: { flexGrow: 1, minHeight: space.sm },
  keys: { gap: space.sm, paddingBottom: space.xs },
  center: { textAlign: 'center' },
});

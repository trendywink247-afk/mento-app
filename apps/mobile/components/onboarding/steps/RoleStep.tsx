import { Ionicons } from '@expo/vector-icons';
import { useContext, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { PLAYGROUND_ASPECT, PlaygroundBand } from '@/components/art/PlaygroundBand';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { StepArrivalContext } from '@/components/motion/stepArrival';
import { StepScaffold } from '@/components/onboarding/StepScaffold';
import { capture } from '@/lib/analytics';
import { useI18n } from '@/lib/i18n';
import { setDraft } from '@/lib/onboardingDraft';
import { saveRole, type Role } from '@/lib/session';
import { useFrameSize } from '@/lib/useFrameSize';
import { duration, forkArrival, stagger } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type, type Wash } from '@/theme/tokens';

/** The board lets the band start 12px under the sub line (it is absolutely placed there,
 * closer than the column's 16 gap). */
const BAND_LIFT = 12;
/** Below this the band would be a sliver — the step scrolls instead. */
const BAND_MIN = 150;

function Door({
  title,
  body,
  icon,
  tone,
  quiet,
  onPress,
  testID,
}: {
  title: string;
  body: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: Wash;
  /** The second door sits on the warm alt surface, a step back from the first. */
  quiet?: boolean;
  onPress: () => void;
  testID: string;
}) {
  const { colors } = useTheme();
  return (
    <PressKey
      onPress={onPress}
      edge={quiet ? colors.edgeAlt : colors.edgeSurface}
      travel={4}
      radius={radius.lg}
      accessibilityLabel={title}
      accessibilityHint={body}
      testID={testID}
      style={[
        styles.door,
        { backgroundColor: quiet ? colors.surfaceAlt : colors.surface, borderColor: colors.border },
      ]}
    >
      <IconBadge icon={icon} tone={tone} size={52} />
      <View style={styles.doorText}>
        <Text style={[type.title, { color: colors.ink }]}>{title}</Text>
        <Text style={[type.bodySmall, { color: colors.inkMuted }]}>{body}</Text>
      </View>
      <Ionicons name="chevron-forward" size={22} color={colors.inkMuted} />
    </PressKey>
  );
}

/** Step zero of the journey (DECISIONS §K.7, "two doors") — board A02: the headline, the
 * companions at play in a full-bleed band, then the two doors pinned to the bottom and
 * the peers-not-therapists line. One tap picks a role and advances — no Continue key,
 * so a member spends exactly one tap here. Role is written to device + draft before
 * advancing. No haptic fires here beyond the key's own press. */
export function RoleStep({ onPick }: { onPick: (role: Role) => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const { width } = useFrameSize();
  // Entered from the landing, the fork plays the board's T01 arrival: the doors rise out of
  // the Start key's place, then the art settles, the headline, the sub, the footer — last.
  // Reached by stepping BACK from the age gate it is an ordinary step (T02, reversed).
  const fromLanding = useContext(StepArrivalContext).kind === 'enter';
  // The band takes the room between the headline and the doors, up to the film's own height.
  const [zoneH, setZoneH] = useState(0);
  const bandH = Math.min(width / PLAYGROUND_ASPECT, Math.max(BAND_MIN, zoneH + BAND_LIFT));

  const pick = (role: Role) => {
    setDraft({ role });
    void saveRole(role);
    capture('role_chosen', { role });
    onPick(role);
  };

  return (
    <StepScaffold
      footerIndex={4}
      footerDelay={fromLanding ? forkArrival.foot : undefined}
      footerDistance={fromLanding ? forkArrival.footRise : undefined}
      footer={
        <Text style={[type.caption, styles.footer, { color: colors.inkMuted }]} testID="role-footer">
          {t('onboarding.role.footer')}
        </Text>
      }
    >
      <View style={styles.head}>
        <Entrance
          index={1}
          delay={fromLanding ? forkArrival.head : undefined}
          distance={fromLanding ? forkArrival.textRise : undefined}
        >
          <Text style={[type.displayHeadline, { color: colors.ink }]} accessibilityRole="header">
            {t('onboarding.role.headline')}
            <Text style={{ color: colors.accent }}>{t('onboarding.role.headlineAccent')}</Text>
          </Text>
        </Entrance>
        <Entrance
          index={1}
          delay={fromLanding ? forkArrival.sub : undefined}
          distance={fromLanding ? forkArrival.textRise : undefined}
        >
          <Text style={[type.body, { color: colors.inkMuted }]}>{t('onboarding.role.sub')}</Text>
        </Entrance>
      </View>

      <View style={styles.zone} onLayout={(e) => setZoneH(e.nativeEvent.layout.height)}>
        {zoneH > 0 ? (
          // The art settles into place (T01): a breath larger and lower, easing to rest.
          <Entrance
            index={0}
            delay={fromLanding ? forkArrival.art : undefined}
            distance={forkArrival.artRise}
            scaleFrom={forkArrival.artScale}
            duration={duration.slow}
            style={[styles.band, { width, height: bandH }]}
          >
            <PlaygroundBand width={width} height={bandH} startAfter={forkArrival.art + duration.slow} />
          </Entrance>
        ) : null}
      </View>

      <View style={styles.doors}>
        <Entrance
          index={2}
          delay={fromLanding ? forkArrival.doors : undefined}
          distance={fromLanding ? forkArrival.doorRise[0] : undefined}
          scaleFrom={fromLanding ? forkArrival.doorScale : 1}
        >
          <Door
            title={t('onboarding.role.talkTitle')}
            body={t('onboarding.role.talkBody')}
            icon="chatbubble-outline"
            tone="accent"
            onPress={() => pick('mentee')}
            testID="role-talk"
          />
        </Entrance>
        <Entrance
          index={3}
          delay={fromLanding ? forkArrival.doors + stagger.unit : undefined}
          distance={fromLanding ? forkArrival.doorRise[1] : undefined}
          scaleFrom={fromLanding ? forkArrival.doorScale : 1}
        >
          <Door
            title={t('onboarding.role.listenTitle')}
            body={t('onboarding.role.listenBody')}
            icon="ear-outline"
            tone="green"
            quiet
            onPress={() => pick('mentor')}
            testID="role-listen"
          />
        </Entrance>
      </View>
    </StepScaffold>
  );
}

const styles = StyleSheet.create({
  head: { gap: 6, zIndex: 1 },
  zone: { flexGrow: 1, minHeight: BAND_MIN - BAND_LIFT, marginVertical: space.xs },
  // Full-bleed: steps out of the scaffold's 24 side padding, and up under the sub line.
  band: { position: 'absolute', left: -space.lg, top: -BAND_LIFT },
  doors: { gap: space.md, zIndex: 1 },
  door: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 104,
    paddingVertical: 18,
    paddingHorizontal: 20,
    borderWidth: 1,
  },
  doorText: { flex: 1, gap: 2 },
  footer: { textAlign: 'center' },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EdgeSurface } from '@/components/EdgeSurface';
import { IconBadge } from '@/components/IconBadge';
import type { CompanionAnimal } from '@/components/art/Companions';
import { CompanionPerches, CompanionSlot, useCompanionPlacement } from '@/components/art/PerchedCompanion';
import { SettleBack, useSheetOpen } from '@/components/motion/BoardSheet';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { CompanionNameRow } from '@/components/profile/CompanionNameRow';
import { RecoveryCard } from '@/components/profile/RecoveryCard';
import { api, type ListenerApplication } from '@/lib/api';
import type { PlacementSlot } from '@/lib/companionPlacement';
import { useI18n } from '@/lib/i18n';
import { canReapply, openMentorSide, reapplyAt, stateOf } from '@/lib/mentorPath';
import { screenCache } from '@/lib/screenCache';
import { getCompanionAnimal, getPersona, type Persona } from '@/lib/session';
import { checkAndApplyUpdate, runningUpdate, type UpdateStatus } from '@/lib/updates';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLOR_LABELS, COMPANION_COLORS, type CompanionColor } from '@/theme/companion';
import { font, radius, space, type, wash, washEdge, type Wash } from '@/theme/tokens';

const COLOR_KEYS = Object.keys(COMPANION_COLORS) as CompanionColor[];

/** The member's companion standing on the identity card (board A09). */
const HERO = 132;
const SWATCH = 44;
const SWATCH_RING = 5; // the selected swatch's ring sits this far outside it

/** Where the companion can be on this screen (lib/companionPlacement.ts). Home is where the
 * board draws it: standing, large, on the identity card — when it is out, that corner of the
 * card is simply empty and it is somewhere else on the page. Every other place uses the same
 * reserved corner or the clear ground around it, so it never covers a word: on the card's
 * top edge, on the growth card's top edge (napping there at night), or hanging under the
 * identity card for the animals that can. `bubble` / `besideAvatar` keep their old ids —
 * stored placements and specs know them. */
const PERCHES: PlacementSlot[] = [
  { id: 'bubble', type: 'top', level: 'mid', home: true },
  { id: 'besideAvatar', type: 'lean', level: 'high' },
  { id: 'growthTop', type: 'top', level: 'mid' },
  { id: 'growthNap', type: 'nap', level: 'mid' },
  { id: 'cardHang', type: 'hang', level: 'mid' },
];

/** One Profile row (board: 60px, 14 radius, a 36px wash disc, 16/22 title, 13/18 line). */
function Row({
  icon,
  tone,
  disc,
  title,
  body,
  extra,
  right,
  onPress,
  quiet = false,
  disabled = false,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone?: Wash;
  /** A neutral disc instead of a wash (Start fresh). */
  disc?: boolean;
  title: string;
  body?: string | null;
  extra?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  quiet?: boolean;
  disabled?: boolean;
  testID?: string;
}) {
  const { colors } = useTheme();
  const inner = (
    <>
      {disc ? (
        <View style={[styles.disc, { backgroundColor: colors.bgLavender }]}>
          <Ionicons name={icon} size={18} color={colors.ink} />
        </View>
      ) : (
        <IconBadge icon={icon} tone={tone} size={36} />
      )}
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: colors.ink }]}>{title}</Text>
        {body ? <Text style={[type.caption, { color: colors.inkMuted }]}>{body}</Text> : null}
        {extra}
      </View>
      {right}
    </>
  );
  const face = [
    styles.row,
    { backgroundColor: quiet ? colors.surfaceAlt : colors.surface, borderColor: colors.border },
  ];
  if (!onPress) {
    return (
      <EdgeSurface edge={colors.edgeSurface} travel={3} radius={radius.md} style={face} testID={testID}>
        {inner}
      </EdgeSurface>
    );
  }
  return (
    <PressKey
      onPress={onPress}
      disabled={disabled}
      edge={quiet ? colors.edgeAlt : colors.edgeSurface}
      radius={radius.md}
      testID={testID}
      style={face}
    >
      {inner}
    </PressKey>
  );
}

/** Profile (board A09): the persona on its card with the companion standing on it, the live
 * colour switcher, then the rows — language, become a mentor (or where the application
 * stands), support the team, two plain-words notes that open in place, updates (native),
 * start fresh. Mirror / UPSC panels are deferred modules. */
export default function ProfileTab() {
  const router = useRouter();
  // Every mentor door goes through the one state machine (lib/mentorPath.ts): approved →
  // Mentor Home on top of Profile; anything else → the mentor path (story / application /
  // where it stands).
  const openMentor = () => void openMentorSide(router, application);
  const { colors, companionColor, setCompanionColor } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const sheetOpen = useSheetOpen();
  // The recolour lands on the device at once (the whole app re-accents) and on the account
  // in the background — a failed save shows nothing and never undoes the choice.
  const recolour = (key: CompanionColor) => {
    setCompanionColor(key);
    void api.saveCompanion({ companion_colour: key }).catch(() => {
      /* reason: best-effort sync; the device copy is what the app reads */
    });
  };
  const [persona, setPersona] = useState<Persona | null>(null);
  const [animal, setAnimal] = useState<CompanionAnimal | null>(null);
  // The status card starts from its last-loaded value so it does not pop in on every return.
  const [application, setApplication] = useState<ListenerApplication | null>(
    screenCache.get('application') ?? null,
  );
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | 'idle'>('idle');
  const [openNote, setOpenNote] = useState<'mentors' | 'privacy' | null>(null);
  // null until GET /me answers (the recovery card waits for it).
  const [hasRecovery, setHasRecovery] = useState<boolean | null>(null);
  const [swatch, setSwatch] = useState(SWATCH);
  const running = runningUpdate();
  // The hero place only exists once the animal is known — until then there is no home slot.
  // A sheet over the screen (Start fresh) hides the companion.
  const perch = useCompanionPlacement('profile', animal ? PERCHES : PERCHES.slice(1), { hidden: sheetOpen });
  // A perch that hangs off its card's edge lands UNDER the next card, because the blocks
  // share one zIndex and the later sibling paints last. Lift the block that actually
  // holds the companion — one of them does, at most.
  const hosts = (...ids: string[]) =>
    perch.slotId && ids.includes(perch.slotId) ? styles.furnitureLift : null;

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void api
        .getListenerApplication()
        .then((a) => {
          screenCache.set('application', a);
          if (active) setApplication(a);
        })
        .catch(() => {
          /* status card is best-effort; the apply row still renders */
        });
      return () => {
        active = false;
      };
    }, []),
  );

  useEffect(() => {
    let active = true;
    void api
      .me()
      .then((me) => {
        if (active) setHasRecovery(Boolean(me.has_recovery));
      })
      .catch(() => {
        if (active) setHasRecovery(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void getPersona().then((p) => {
      if (active) setPersona(p);
    });
    void getCompanionAnimal().then((a) => {
      if (active) setAnimal((a as CompanionAnimal | null) ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  // Manual EAS Update check — native-only, `Updates.isEnabled` is false on
  // web/dev-client (checkAndApplyUpdate resolves 'upToDate' immediately there).
  const handleCheckUpdates = useCallback(async () => {
    await checkAndApplyUpdate(setUpdateStatus);
  }, []);

  const chevron = <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />;
  const noteChevron = (open: boolean) => (
    <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={18} color={colors.inkMuted} />
  );

  return (
    <SettleBack>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <CompanionPerches placement={perch}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
            <Entrance>
              <Text style={[type.title, styles.title, { color: colors.ink }]} accessibilityRole="header">
                {t('profile.title')}
              </Text>
            </Entrance>

            {/* The identity card. Its right-hand corner belongs to the companion. */}
            <View style={[styles.furniture, hosts('bubble', 'besideAvatar', 'cardHang')]}>
              <Entrance index={1}>
                <EdgeSurface
                  edge={colors.edgeSurface}
                  travel={3}
                  radius={radius.lg}
                  style={[styles.identity, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <Text style={[styles.name, { color: colors.ink }]} testID="profile-persona">
                    {persona?.persona_name ?? t('profile.anonymous')}
                  </Text>
                  <View style={[styles.privatePill, { backgroundColor: colors.accentTint }]}>
                    <Text style={[styles.privateText, { color: colors.accent }]}>{t('profilePage.private')}</Text>
                  </View>
                  <Text style={[type.caption, { color: colors.inkMuted }]}>{t('profile.identityNote')}</Text>
                </EdgeSurface>
              </Entrance>
              {perch.slotId === 'bubble' ? (
                <View style={[styles.heroGround, { backgroundColor: colors.edgeSurface }]} pointerEvents="none" />
              ) : null}
              {/* It is simply there — no arrival class on the companion. */}
              <View style={styles.hero} pointerEvents="box-none">
                <CompanionSlot id="bubble" flow size={HERO} interactive />
              </View>
              <CompanionSlot id="besideAvatar" size={60} inset={40} />
              <CompanionSlot id="cardHang" size={56} inset={40} />
            </View>

            <View style={[styles.furniture, hosts('growthTop', 'growthNap')]}>
              <CompanionSlot id="growthTop" size={56} inset={36} />
              <CompanionSlot id="growthNap" size={56} inset={36} />
              <Entrance index={2}>
                <EdgeSurface
                  edge={colors.edgeAlt}
                  travel={3}
                  radius={radius.lg}
                  style={[styles.growth, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                >
                  <Text style={[styles.rowTitle, styles.growthText, { color: colors.ink }]}>
                    {t('profile.companionTitle')}
                  </Text>
                  <CompanionNameRow animal={animal} />
                  <View
                    style={styles.swatches}
                    onLayout={(e) => {
                      // Seven 44px keys fit a 390 phone; a 360 one gets slightly smaller keys
                      // rather than a second row. The ring's room is part of the sum.
                      const room = e.nativeEvent.layout.width - 2 * SWATCH_RING;
                      setSwatch(Math.min(SWATCH, Math.floor((room - (COLOR_KEYS.length - 1) * 2) / COLOR_KEYS.length)));
                    }}
                  >
                    {COLOR_KEYS.map((key) => {
                      const selected = key === companionColor;
                      const set = COMPANION_COLORS[key];
                      return (
                        <View key={key} style={{ width: swatch, height: swatch + 4 }}>
                          {selected ? (
                            <View
                              pointerEvents="none"
                              style={[
                                styles.ring,
                                { width: swatch + 2 * SWATCH_RING, height: swatch + 2 * SWATCH_RING, borderColor: colors.ink },
                              ]}
                            />
                          ) : null}
                          <PressKey
                            onPress={() => recolour(key)}
                            edge={selected ? 'transparent' : set.accentEdge}
                            radius={radius.pill}
                            intent="select"
                            accessibilityState={{ selected }}
                            accessibilityLabel={t('onboarding.companion.themeA11y', { label: COMPANION_COLOR_LABELS[key] })}
                            testID={`profile-colour-${key}`}
                            style={{ width: swatch, height: swatch, backgroundColor: set.accent }}
                          >
                            {null}
                          </PressKey>
                        </View>
                      );
                    })}
                  </View>
                  <Text style={[type.caption, styles.growthText, { color: colors.inkMuted }]}>
                    {t('profile.recolour')}
                  </Text>
                </EdgeSurface>
              </Entrance>
            </View>

            <Entrance index={3} style={styles.rows}>
              <Row
                icon="globe-outline"
                tone="sky"
                title={t('profile.language')}
                right={
                  <View
                    style={[styles.lang, { backgroundColor: colors.bgLavender }]}
                    accessibilityLabel={t('profile.language')}
                  >
                    {(['en', 'hi'] as const).map((l) => {
                      const selected = locale === l;
                      const label = l === 'en' ? t('profile.languageEnglish') : t('profile.languageHindi');
                      return (
                        <PressKey
                          key={l}
                          onPress={() => setLocale(l)}
                          edge="transparent"
                          travel={2}
                          radius={radius.pill}
                          intent="select"
                          accessibilityState={{ selected }}
                          accessibilityLabel={label}
                          testID={`profile-lang-${l}`}
                          style={[styles.langKey, selected && { backgroundColor: colors.ink }]}
                        >
                          <Text style={[type.label, { color: selected ? colors.onBrand : colors.ink }]}>{label}</Text>
                        </PressKey>
                      );
                    })}
                  </View>
                }
              />

              <MentorRow application={application} onPress={openMentor} chevron={chevron} />

              <Row
                icon="cafe-outline"
                tone="orange"
                title={t('profile.coffeeTitle')}
                body={t('profile.coffeeBody')}
                right={chevron}
                onPress={() => router.push('/coffee')}
                testID="profile-coffee"
              />

              <Row
                icon="heart-outline"
                tone="danger"
                title={t('profile.listenersTitle')}
                body={openNote === 'mentors' ? t('profile.listenersBody') : null}
                right={noteChevron(openNote === 'mentors')}
                onPress={() => setOpenNote(openNote === 'mentors' ? null : 'mentors')}
                testID="profile-note-mentors"
              />

              <Row
                icon="shield-outline"
                tone="indigo"
                title={t('profile.privacyTitle')}
                body={openNote === 'privacy' ? t('profile.privacyBody') : null}
                right={noteChevron(openNote === 'privacy')}
                onPress={() => setOpenNote(openNote === 'privacy' ? null : 'privacy')}
                testID="profile-note-privacy"
              />

              {Platform.OS !== 'web' ? (
                <Row
                  icon="cloud-download-outline"
                  tone="sky"
                  title={t('profile.updatesTitle')}
                  body={
                    updateStatus === 'checking'
                      ? t('updates.checking')
                      : updateStatus === 'downloading'
                        ? t('updates.downloading')
                        : updateStatus === 'restarting'
                          ? t('updates.restarting')
                          : updateStatus === 'upToDate'
                            ? t('updates.upToDate')
                            : updateStatus === 'checkFailed'
                              ? t('updates.checkFailed')
                              : t('profile.updatesBody')
                  }
                  extra={
                    running.kind !== 'dev' ? (
                      <Text style={[type.caption, { color: colors.inkMuted }]} testID="profile-running-update">
                        {running.kind === 'ota'
                          ? t('updates.runningOta', { id: running.id ?? '?' })
                          : t('updates.runningEmbedded')}
                      </Text>
                    ) : null
                  }
                  onPress={() => void handleCheckUpdates()}
                  disabled={updateStatus === 'checking' || updateStatus === 'downloading' || updateStatus === 'restarting'}
                  testID="profile-check-updates"
                />
              ) : null}

              {/* The member's own way back on a new phone (WS3 T3.5). Waits for GET /me so
                  "make" vs "make a new one" is right the first time. */}
              {hasRecovery !== null ? <RecoveryCard hasCode={hasRecovery} /> : null}

              <Row
                icon="leaf-outline"
                disc
                quiet
                title={t('profile.startFreshTitle')}
                body={t('profile.startFreshBody')}
                onPress={() => router.push('/start-fresh')}
                testID="profile-start-fresh"
              />
            </Entrance>

            <Entrance index={4}>
              <Text style={[type.caption, styles.version, { color: colors.inkMuted }]}>{t('profile.version')}</Text>
            </Entrance>
          </ScrollView>
        </CompanionPerches>
      </SafeAreaView>
    </SettleBack>
  );
}

/** The mentor door on Profile — its words follow the SERVER's application state (DECISIONS
 * §L.12): not applied → "Become a mentor"; in review → "Mentor application · in review";
 * declined → the calm note with when they may apply again; approved → "Open the mentor side"
 * with a small "Mentor access" chip. One tap, one door (`openMentorSide`). */
function MentorRow({
  application,
  onPress,
  chevron,
}: {
  application: ListenerApplication | null;
  onPress: () => void;
  chevron: ReactNode;
}) {
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const state = stateOf(application);
  if (state === 'approved') {
    return (
      <Row
        icon="leaf-outline"
        tone="green"
        title={t('mentorPath.profileApprovedTitle')}
        body={t('mentorPath.profileApprovedBody')}
        extra={
          <View style={[styles.accessChip, { backgroundColor: wash.green, borderColor: washEdge.green }]} testID="profile-mentor-access">
            <Ionicons name="checkmark" size={12} color={COMPANION_COLORS.sage.accentEdge} />
            <Text style={[styles.accessText, { color: COMPANION_COLORS.sage.accentEdge }]}>{t('mentorPath.accessChip')}</Text>
          </View>
        }
        right={chevron}
        onPress={onPress}
        testID="profile-open-console"
      />
    );
  }
  if (state === 'review') {
    return (
      <Row
        icon="time-outline"
        tone="orange"
        title={t('mentorPath.profileReviewTitle')}
        body={t('mentorPath.profileReviewBody')}
        right={chevron}
        onPress={onPress}
        testID="profile-listener-status"
      />
    );
  }
  if (state === 'declined') {
    const at = reapplyAt(application);
    const body =
      canReapply(application) || !at
        ? t('mentorPath.profileDeclinedNow')
        : t('mentorPath.profileDeclinedLater', {
            date: at.toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', { day: 'numeric', month: 'long' }),
          });
    return (
      <Row
        icon="bulb-outline"
        tone="green"
        title={t('profile.declinedTitle')}
        body={body}
        right={chevron}
        onPress={onPress}
        testID="profile-listener-status"
      />
    );
  }
  return (
    <Row
      icon="bulb-outline"
      tone="green"
      title={t('profile.becomeTitle')}
      body={t('profile.becomeBody')}
      right={chevron}
      onPress={onPress}
      testID="profile-become-listener"
    />
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: space.md, paddingBottom: space.lg, gap: 14 },
  title: { paddingTop: space.xs, paddingHorizontal: space.sm },
  furniture: { zIndex: 1 },
  furnitureLift: { zIndex: 4 },
  identity: {
    minHeight: 124,
    paddingVertical: space.md,
    paddingLeft: space.md,
    paddingRight: HERO + 8,
    alignItems: 'flex-start',
    gap: 6,
    borderWidth: 1,
  },
  name: { fontFamily: font.sansHeavy, fontSize: 24, lineHeight: 30 },
  privatePill: { height: 24, paddingHorizontal: 10, justifyContent: 'center', borderRadius: radius.pill },
  privateText: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16 },
  // Feet on the card, 14 up from its bottom edge (the art carries ~6% of ground padding).
  hero: { position: 'absolute', right: 4, bottom: 4, zIndex: 2 },
  heroGround: {
    position: 'absolute',
    right: 22,
    bottom: 9,
    width: 96,
    height: 16,
    borderRadius: radius.pill,
    zIndex: 1,
  },
  growth: { paddingTop: 14, paddingHorizontal: 14, paddingBottom: 12, gap: space.sm, borderWidth: 1 },
  growthText: { paddingHorizontal: 2 },
  swatches: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: SWATCH_RING,
    paddingTop: SWATCH_RING,
    paddingBottom: 2,
  },
  ring: {
    position: 'absolute',
    left: -SWATCH_RING,
    top: -SWATCH_RING,
    borderRadius: radius.pill,
    borderWidth: 2,
  },
  rows: { gap: 12 },
  row: {
    minHeight: 60,
    paddingVertical: space.sm,
    paddingLeft: 14,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 22 },
  disc: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  lang: { flexDirection: 'row', gap: space.xs, padding: 3, borderRadius: radius.pill },
  langKey: { height: 44, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  accessChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 24,
    marginTop: 4,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  accessText: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16 },
  version: { textAlign: 'center' },
});

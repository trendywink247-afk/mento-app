import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { IconBadge } from '@/components/IconBadge';
import { Screen } from '@/components/Screen';
import { Companion } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { PressKey } from '@/components/motion/PressKey';
import { api, type ListenerApplication } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { getCompanionAnimal, getPersona, saveRole, type Persona } from '@/lib/session';
import { checkAndApplyUpdate, type UpdateStatus } from '@/lib/updates';
import { useTheme } from '@/theme/ThemeProvider';
import {
  COMPANION_COLOR_LABELS,
  COMPANION_COLORS,
  type CompanionColor,
} from '@/theme/companion';
import { font, radius, space, type } from '@/theme/tokens';

const COLOR_KEYS = Object.keys(COMPANION_COLORS) as CompanionColor[];

/** Lightweight v1 Profile: persona identity, live companion-colour switcher,
 * support & about. (Mirror/UPSC panels are deferred modules.) */
export default function ProfileTab() {
  const router = useRouter();
  const openMentorConsole = async () => {
    await saveRole('mentor');
    router.push('/mentor-home');
  };
  const { colors, companionColor, setCompanionColor } = useTheme();
  const { t, locale, setLocale } = useI18n();
  const [persona, setPersona] = useState<Persona | null>(null);
  const [animal, setAnimal] = useState<CompanionAnimal | null>(null);
  const [application, setApplication] = useState<ListenerApplication | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | 'idle'>('idle');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void api
        .getListenerApplication()
        .then((a) => {
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

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space.lg }}>
        <Text style={[type.displaySerif, { color: colors.ink }]} accessibilityRole="header">
          {t('profile.title')}
        </Text>

        <View style={styles.identity}>
          <PersonaAvatar name={persona?.persona_name ?? 'Mento'} size={88} />
          <Text style={[styles.name, { color: colors.ink }]}>
            {persona?.persona_name ?? t('profile.anonymous')}
          </Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>
            {t('profile.identityNote')}
          </Text>
        </View>

        <EdgeSurface
          edge={colors.edgeSurface}
          style={[styles.card, { backgroundColor: colors.surface }]}
        >
          <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('profile.companionTitle')}</Text>
          {animal ? (
            <View style={styles.companionRow}>
              <View style={[styles.companionBubble, { backgroundColor: colors.accentTint }]}>
                <Companion animal={animal} size={44} interactive />
              </View>
              <Text style={[type.bodySemi, { color: colors.ink }]}>
                {COMPANION_COLOR_LABELS[companionColor]} {animal}
              </Text>
            </View>
          ) : null}
          <Text style={[type.caption, { color: colors.inkMuted }]}>
            {t('profile.recolour')}
          </Text>
          <View style={styles.swatches}>
            {COLOR_KEYS.map((key) => {
              const selected = key === companionColor;
              const set = COMPANION_COLORS[key];
              return (
                <Pressable
                  key={key}
                  onPress={() => setCompanionColor(key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={t('onboarding.companion.themeA11y', { label: COMPANION_COLOR_LABELS[key] })}
                  testID={`profile-colour-${key}`}
                  style={[styles.swatchWrap, selected && { borderColor: set.accent, borderWidth: 2 }]}
                >
                  <View style={[styles.swatch, { backgroundColor: set.accent }]}>
                    {selected ? <Ionicons name="checkmark" size={14} color={set.onAccent} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </EdgeSurface>

        <Text style={[styles.section, { color: colors.ink }]}>{t('profile.section')}</Text>

        <EdgeSurface
          edge={colors.edgeSurface}
          style={[styles.row, { backgroundColor: colors.surface }]}
          containerStyle={styles.rowSpacing}
        >
          <IconBadge icon="language-outline" size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: colors.ink }]}>{t('profile.language')}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              {t('profile.languageBody')}
            </Text>
          </View>
          <View style={styles.langChips}>
            {(['en', 'hi'] as const).map((l) => {
              const selected = locale === l;
              const label = l === 'en' ? t('profile.languageEnglish') : t('profile.languageHindi');
              return (
                <Pressable
                  key={l}
                  onPress={() => setLocale(l)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={label}
                  testID={`profile-lang-${l}`}
                  style={[
                    styles.langChip,
                    selected
                      ? { backgroundColor: colors.accent }
                      : { borderWidth: 1, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.langChipText, { color: selected ? colors.onAccent : colors.inkMuted }]}>
                    {label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </EdgeSurface>

        <PressKey
          onPress={() => router.push('/coffee')}
          edge={colors.edgeSurface}
          testID="profile-coffee"
          style={[styles.row, { backgroundColor: colors.surface }]}
          containerStyle={styles.rowSpacing}
        >
          <IconBadge icon="cafe-outline" tone="orange" size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: colors.ink }]}>{t('profile.coffeeTitle')}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              {t('profile.coffeeBody')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
        </PressKey>

        <EdgeSurface
          edge={colors.edgeSurface}
          style={[styles.row, { backgroundColor: colors.surface }]}
          containerStyle={styles.rowSpacing}
        >
          <IconBadge icon="heart-outline" size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: colors.ink }]}>{t('profile.listenersTitle')}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              {t('profile.listenersBody')}
            </Text>
          </View>
        </EdgeSurface>

        <EdgeSurface
          edge={colors.edgeSurface}
          style={[styles.row, { backgroundColor: colors.surface }]}
          containerStyle={styles.rowSpacing}
        >
          <IconBadge icon="shield-checkmark-outline" tone="green" size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: colors.ink }]}>{t('profile.privacyTitle')}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              {t('profile.privacyBody')}
            </Text>
          </View>
        </EdgeSurface>

        {application === null ? (
          <PressKey
            onPress={() => router.push('/listener-apply')}
            edge={colors.edgeSurface}
            testID="profile-become-listener"
            style={[styles.row, { backgroundColor: colors.surface }]}
            containerStyle={styles.rowSpacing}
          >
            <IconBadge icon="ear-outline" tone="green" size={44} />
            <View style={{ flex: 1 }}>
              <Text style={[type.label, { color: colors.ink }]}>{t('profile.becomeTitle')}</Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>
                {t('profile.becomeBody')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
          </PressKey>
        ) : application.status === 'declined' ? (
          /* Declined members can reapply — the server enforces the cool-down (409
           * surfaces through the apply screen's error display). */
          <PressKey
            onPress={() => router.push('/listener-apply')}
            edge={colors.edgeSurface}
            testID="profile-listener-status"
            style={[styles.row, { backgroundColor: colors.surface }]}
            containerStyle={styles.rowSpacing}
          >
            <IconBadge icon="ear-outline" tone="accent" size={44} />
            <View style={{ flex: 1 }}>
              <Text style={[type.label, { color: colors.ink }]}>{t('profile.declinedTitle')}</Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>
                {t('profile.declinedBody')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
          </PressKey>
        ) : (
          <EdgeSurface
            edge={colors.edgeSurface}
            style={[styles.row, { backgroundColor: colors.surface }]}
            containerStyle={styles.rowSpacing}
            testID="profile-listener-status"
          >
            <IconBadge
              icon={application.status === 'approved' ? 'checkmark-circle-outline' : 'ear-outline'}
              tone={application.status === 'approved' ? 'green' : 'accent'}
              size={44}
            />
            <View style={{ flex: 1 }}>
              <Text style={[type.label, { color: colors.ink }]}>
                {application.status === 'approved'
                  ? t('profile.approvedTitle')
                  : t('profile.receivedTitle')}
              </Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>
                {application.status === 'approved'
                  ? t('profile.approvedBody')
                  : t('profile.receivedBody')}
              </Text>
              {application.status === 'approved' ? (
                <Pressable
                  // The console lives IN the app now (DECISIONS §K.9): switch the
                  // device's role and go to Mentor Home — never the browser link.
                  onPress={() => void openMentorConsole()}
                  accessibilityRole="button"
                  testID="profile-open-console"
                  style={{ minHeight: 44, justifyContent: 'center' }}
                >
                  <Text style={[type.bodySemi, { color: colors.accent }]}>
                    {t('profile.openConsole')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </EdgeSurface>
        )}

        {Platform.OS !== 'web' ? (
          <PressKey
            onPress={() => void handleCheckUpdates()}
            disabled={updateStatus === 'checking' || updateStatus === 'downloading' || updateStatus === 'restarting'}
            edge={colors.edgeSurface}
            testID="profile-check-updates"
            style={[styles.row, { backgroundColor: colors.surface }]}
            containerStyle={styles.rowSpacing}
          >
            <IconBadge icon="cloud-download-outline" size={44} />
            <View style={{ flex: 1 }}>
              <Text style={[type.label, { color: colors.ink }]}>{t('profile.updatesTitle')}</Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>
                {updateStatus === 'checking'
                  ? t('updates.checking')
                  : updateStatus === 'downloading'
                    ? t('updates.downloading')
                    : updateStatus === 'restarting'
                      ? t('updates.restarting')
                      : updateStatus === 'upToDate'
                        ? t('updates.upToDate')
                        : updateStatus === 'checkFailed'
                          ? t('updates.checkFailed')
                          : t('profile.updatesBody')}
              </Text>
            </View>
          </PressKey>
        ) : null}

        <PressKey
          onPress={() => router.push('/start-fresh')}
          edge={colors.edgeSurface}
          testID="profile-start-fresh"
          style={[styles.row, { backgroundColor: colors.surface }]}
          containerStyle={styles.rowSpacing}
        >
          <IconBadge icon="leaf-outline" tone="danger" size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: colors.danger }]}>{t('profile.startFreshTitle')}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              {t('profile.startFreshBody')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
        </PressKey>

        <Text style={[type.caption, styles.version, { color: colors.inkMuted }]}>
          {t('profile.version')}
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: 'center', gap: space.xs, marginVertical: space.md },
  name: { fontFamily: font.serifBold, fontSize: 26, lineHeight: 33 },
  card: { borderRadius: radius.lg, padding: space.md, gap: space.xs },
  cardTitle: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 23 },
  companionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.sm,
    marginBottom: space.xs,
  },
  companionBubble: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  swatchWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { fontFamily: font.sansBold, fontSize: 18, lineHeight: 25, marginTop: space.lg, marginBottom: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.sm + 2,
  },
  rowSpacing: { marginBottom: space.sm },
  version: { textAlign: 'center', marginTop: space.md },
  langChips: { flexDirection: 'row', gap: space.xs },
  langChip: {
    borderRadius: radius.pill,
    paddingVertical: space.xs + 2,
    paddingHorizontal: space.sm + 4,
  },
  langChipText: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
});

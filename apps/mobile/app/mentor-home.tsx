import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApplicationForm } from '@/components/ApplicationForm';
import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Companion } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { Entrance } from '@/components/motion/Entrance';
import { Tilt3D } from '@/components/motion/Tilt3D';
import { api, type ListenerApplication } from '@/lib/api';
import { haptic } from '@/lib/haptics';
import { useI18n } from '@/lib/i18n';
import {
  getCompanionAnimal,
  getPersona,
  saveCompanionAnimal,
  saveCompanionColor,
  saveRole,
  type Persona,
} from '@/lib/session';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { DEFAULT_COMPANION_COLOR } from '@/theme/companion';
import { font, radius, space, type } from '@/theme/tokens';

/** Mentor Home (DECISIONS §K.7): the mentor branch's landing until the native
 * console exists. Outside the tab shell. Hosts the shared ApplicationForm inline
 * (no application yet), the status card (pending / approved / declined) and the
 * private console link, plus a quiet switch back to the talking side. */
export default function MentorHome() {
  useSessionGuard();
  const router = useRouter();
  const { colors, elevation, setCompanionColor } = useTheme();
  const { t } = useI18n();
  const [persona, setPersona] = useState<Persona | null>(null);
  const [animal, setAnimal] = useState<CompanionAnimal | null>(null);
  // undefined = still loading; null = no application on file.
  const [application, setApplication] = useState<ListenerApplication | null | undefined>(undefined);
  const [loadError, setLoadError] = useState(false);
  const [switching, setSwitching] = useState(false);
  const approvedHapticFired = useRef(false);

  // Best-effort — a persona/animal fetch failure should never blank the hero or
  // block the application status from loading.
  const loadIdentity = useCallback(async () => {
    try {
      const [p, a] = await Promise.all([getPersona(), getCompanionAnimal()]);
      setPersona(p);
      setAnimal(a as CompanionAnimal | null);
    } catch {
      // ignore — hero renders fine with a null persona/companion.
    }
  }, []);

  const loadApplication = useCallback(async () => {
    try {
      const app = await api.getListenerApplication();
      setApplication(app);
      setLoadError(false);
    } catch {
      // Leave `application` as-is (no spinner flash, no accidental form reveal —
      // an unknown status must never show the form, that risks a duplicate apply).
      setLoadError(true);
    }
  }, []);

  const load = useCallback(async () => {
    await Promise.all([loadIdentity(), loadApplication()]);
  }, [loadIdentity, loadApplication]);

  // Status can change while the app is backgrounded (admin approves) — refetch on focus.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // One arrival haptic, only for the approved state, only once per mount.
  useEffect(() => {
    if (application?.status === 'approved' && !approvedHapticFired.current) {
      approvedHapticFired.current = true;
      haptic.success();
    }
  }, [application]);

  const switchToTalk = async () => {
    if (switching) return;
    setSwitching(true);
    try {
      // Mentors never chose a companion; the talking side needs one for theming.
      if (!(await getCompanionAnimal())) {
        await saveCompanionAnimal('Panda');
        await saveCompanionColor(DEFAULT_COMPANION_COLOR);
        setCompanionColor(DEFAULT_COMPANION_COLOR);
      }
      await saveRole('mentee');
      router.dismissAll();
      router.replace('/chats');
    } catch {
      // Stay still and silent (T&S: no shaking/buzzing at a struggling user) —
      // release the spinner so the button is tappable again.
      setSwitching(false);
    }
  };

  return (
    <Screen scroll bg="lavender">
      <Entrance index={0}>
        <View style={styles.hero} testID="mentor-home">
          <Tilt3D maxTilt={6}>
            <Companion animal={animal} size={96} />
          </Tilt3D>
          <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
            {t('mentorHome.title')}
          </Text>
          {persona ? (
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              {t('mentorHome.appearAs', { name: persona.persona_name })}
            </Text>
          ) : null}
        </View>
      </Entrance>

      {loadError ? (
        <Entrance index={1}>
          <View style={[styles.card, elevation.sm, { backgroundColor: colors.surface }]} testID="mentor-load-error">
            <Text style={[type.body, { color: colors.ink }]}>{t('mentorHome.loadError')}</Text>
            <PrimaryButton label={t('connecting.tryAgain')} variant="ghost" onPress={() => void load()} testID="mentor-retry" />
          </View>
        </Entrance>
      ) : application === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : application === null ? (
        <Entrance index={1}>
          <Text style={[type.body, styles.intro, { color: colors.inkMuted }]}>{t('mentorHome.applyIntro')}</Text>
          <ApplicationForm onSuccess={(result) => setApplication(result)} />
        </Entrance>
      ) : application.status === 'declined' ? (
        <Entrance index={1}>
          <View style={[styles.card, elevation.sm, { backgroundColor: colors.surface }]} testID="mentor-status">
            <Text style={[type.label, { color: colors.ink }]}>{t('profile.declinedTitle')}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{t('profile.declinedBody')}</Text>
          </View>
          {/* The server owns the 30-day reapply cooldown (anchored on decline time,
              which this client doesn't have) — always offer the form and let its
              own error display surface a 409 if it's too soon, exactly like the
              Profile → apply path already does. */}
          <Text style={[type.body, styles.intro, { color: colors.inkMuted }]}>{t('mentorHome.applyIntro')}</Text>
          <ApplicationForm onSuccess={(result) => setApplication(result)} />
        </Entrance>
      ) : (
        <Entrance index={1}>
          <View style={[styles.card, styles.row, elevation.sm, { backgroundColor: colors.surface }]} testID="mentor-status">
            <IconBadge
              icon={application.status === 'approved' ? 'checkmark-circle-outline' : 'ear-outline'}
              tone={application.status === 'approved' ? 'green' : 'accent'}
              size={44}
            />
            <View style={{ flex: 1 }}>
              <Text style={[type.label, { color: colors.ink }]}>
                {application.status === 'approved' ? t('profile.approvedTitle') : t('profile.receivedTitle')}
              </Text>
              <Text style={[type.caption, { color: colors.inkMuted }]}>
                {application.status === 'approved' ? t('profile.approvedBody') : t('profile.receivedBody')}
              </Text>
              {application.status === 'approved' && application.console_url ? (
                <Pressable
                  onPress={() => void Linking.openURL(application.console_url as string)}
                  accessibilityRole="link"
                  testID="mentor-open-console"
                  style={styles.link}
                >
                  <Text style={[type.bodySemi, { color: colors.accent }]}>{t('profile.openConsole')}</Text>
                  <Ionicons name="open-outline" size={16} color={colors.accent} />
                </Pressable>
              ) : null}
            </View>
          </View>
        </Entrance>
      )}

      <Entrance index={2}>
        <PrimaryButton
          label={t('mentorHome.switchTalk')}
          variant="link"
          onPress={() => void switchToTalk()}
          loading={switching}
          testID="mentor-switch-talk"
        />
      </Entrance>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.xs, marginTop: space.lg, marginBottom: space.xl },
  title: { fontFamily: font.sansHeavy, fontSize: 30, lineHeight: 38, textAlign: 'center' },
  center: { alignItems: 'center', paddingVertical: space.xl },
  card: { borderRadius: radius.lg, padding: space.md, gap: space.xs, marginBottom: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  intro: { marginBottom: space.md },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 44 },
});

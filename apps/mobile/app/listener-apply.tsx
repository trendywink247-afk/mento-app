import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApplicationForm } from '@/components/ApplicationForm';
import type { CompanionAnimal } from '@/components/art/Companions';
import { ApplicationStatusCard } from '@/components/mentor/ApplicationStatusCard';
import { MentorPageHeader } from '@/components/mentor/MentorPageHeader';
import { SageSky } from '@/components/motion/SageSky';
import { api, type ListenerApplication } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { listenerApi } from '@/lib/listenerApi';
import { getListenerToken, saveListenerToken } from '@/lib/listenerSession';
import { getCompanionAnimal, saveRole } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import { space } from '@/theme/tokens';

/** Today's rotating name for an approved member: the console credential carries it (the
 * same mint Mentor Home makes), or `GET /listener/me` when a token is already here. */
async function todaysName(): Promise<string | null> {
  try {
    if (await getListenerToken()) return (await listenerApi.me()).persona_name;
    const cs = await api.consoleSession();
    await saveListenerToken(cs.listener_token);
    return cs.persona_name;
  } catch {
    return null;
  }
}

/** Become a mentor (board A37), reached from Profile: the form, then — from the server's
 * own status, never a switch — In review, or Approved with the way into Mentor Home. */
export default function ListenerApply() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  // undefined = loading; null = nothing on file.
  const [application, setApplication] = useState<ListenerApplication | null | undefined>(undefined);
  const [animal, setAnimal] = useState<CompanionAnimal | null>(null);
  const [persona, setPersona] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void getCompanionAnimal()
      .then((a) => {
        if (live) setAnimal(a as CompanionAnimal | null);
      })
      .catch(() => {});
    void api
      .getListenerApplication()
      .then((app) => {
        if (live) setApplication(app);
      })
      .catch(() => {
        if (live) setApplication(null);
      });
    return () => {
      live = false;
    };
  }, []);

  const status = application?.status;
  useEffect(() => {
    if (status !== 'approved') return;
    let live = true;
    void todaysName().then((name) => {
      if (live) setPersona(name);
    });
    return () => {
      live = false;
    };
  }, [status]);

  const openHome = async () => {
    // Same as Profile's way in (DECISIONS §K.9): the device becomes a mentor's, and back
    // from Mentor Home still lands on Profile.
    await saveRole('mentor');
    router.replace('/mentor-home');
  };

  const showForm = application === null || status === 'declined';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <SageSky shape="top" />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.content}
      >
        <MentorPageHeader eyebrow={t('mentorApply.eyebrow')} title={t('mentorApply.title')} onBack={() => router.back()} />
        {application === undefined ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : showForm ? (
          <View style={styles.body}>
            {status === 'declined' && application ? (
              <ApplicationStatusCard state="declined" application={application} animal={animal} />
            ) : null}
            <ApplicationForm onSuccess={(result) => setApplication(result)} />
          </View>
        ) : application ? (
          <ApplicationStatusCard
            state={status === 'approved' ? 'approved' : 'review'}
            application={application}
            animal={animal}
            persona={persona}
            onRead={() => router.push('/mentor/reading')}
            onBackToProfile={() => router.back()}
            onOpenHome={() => void openHome()}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg, gap: 12 },
  body: { gap: 14 },
  center: { alignItems: 'center', paddingVertical: space.xl },
});

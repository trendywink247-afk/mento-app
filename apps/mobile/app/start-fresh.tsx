import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Panda } from '@/components/art/Panda';
import { forgetPlacements } from '@/lib/companionPlacement';
import { clearListenerSession } from '@/lib/listenerSession';
import { disconnectListenerClient } from '@/lib/listenerStreamClient';
import { unregisterPush } from '@/lib/pushNotifications';
import { clearSession, getPersona, type Persona } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import { DEFAULT_COMPANION_COLOR } from '@/theme/companion';
import { font, radius, space, type } from '@/theme/tokens';

/** Start-fresh confirmation, presented as a transparentModal route.
 * reason: this was the app's only RN <Modal>; under the new architecture on
 * Android it presented natively but rendered its content blank (invisible
 * full-screen layer = "frozen" app). Screens-backed routes render everywhere. */
export default function StartFreshDialog() {
  const router = useRouter();
  const { colors, elevation, setCompanionColor } = useTheme();
  const [persona, setPersona] = useState<Persona | null>(null);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let active = true;
    void getPersona().then((p) => {
      if (active) setPersona(p);
    });
    return () => {
      active = false;
    };
  }, []);

  const confirm = async () => {
    if (leaving) return;
    setLeaving(true);
    setCompanionColor(DEFAULT_COMPANION_COLOR); // un-tint before the new onboarding picks its own
    await unregisterPush();
    await clearSession();
    forgetPlacements(); // a new identity has no history of places
    await clearListenerSession();
    await disconnectListenerClient().catch(() => {});
    router.dismissAll();
    router.replace('/');
  };

  const cancel = () => {
    if (leaving) return;
    router.back();
  };

  return (
    <View style={[styles.backdrop, { backgroundColor: colors.scrim }]}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={cancel}
        accessibilityLabel="Dismiss"
        testID="start-fresh-backdrop"
      />
      <View style={[styles.card, { backgroundColor: colors.surface }, elevation.md]} testID="start-fresh-modal">
        <Panda pose="wave" size={110} />
        <Text style={[styles.title, { color: colors.ink }]}>Start fresh?</Text>
        <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
          You&apos;ll get a brand-new persona.{' '}
          {persona?.persona_name ?? 'This persona'}&apos;s chats and journals stay behind —
          there&apos;s no way back to them.
        </Text>
        <View style={styles.actions}>
          <PrimaryButton
            label="Yes, start fresh"
            onPress={() => void confirm()}
            loading={leaving}
            testID="start-fresh-confirm"
          />
          <PrimaryButton
            label="Keep my space"
            variant="link"
            onPress={cancel}
            disabled={leaving}
            testID="start-fresh-cancel"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  card: {
    alignSelf: 'stretch',
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
    alignItems: 'center',
  },
  title: { fontFamily: font.serifBold, fontSize: 24, lineHeight: 30, textAlign: 'center' },
  actions: { alignSelf: 'stretch', gap: space.xs, marginTop: space.sm },
});

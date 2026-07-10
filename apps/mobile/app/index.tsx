import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/PrimaryButton';
import { LogoLockup } from '@/components/art/Logo';
import { MountainsScene } from '@/components/art/Scenes';
import { getSessionToken } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import { font, space, type } from '@/theme/tokens';

/** Landing per mockup #2: centered logo lockup, big headline with the soft-lavender
 * "understands.", ink CTA pill, full-bleed mountain footer. */
export default function Landing() {
  const router = useRouter();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  // Returning users (existing anonymous session) skip onboarding and land on My Chats;
  // render nothing while the secure store resolves so the landing never flashes first.
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let active = true;
    void getSessionToken().then((token) => {
      if (!active) return;
      if (token) router.replace('/chats');
      else setChecked(true);
    });
    return () => {
      active = false;
    };
  }, [router]);

  if (!checked) return null;

  return (
    <View style={[styles.root, { backgroundColor: colors.bg }]}>
      <View style={styles.mountains} pointerEvents="none">
        <MountainsScene width={width} height={190} />
      </View>

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.logoZone}>
          <LogoLockup markSize={64} />
        </View>

        <View style={styles.hero}>
          <Text
            style={[styles.headline, { color: colors.ink }]}
            accessibilityRole="header"
          >
            A place to talk{'\n'}with a peer who{'\n'}
            <Text style={{ color: colors.accentSoft }}>understands.</Text>
          </Text>
          <Text style={[type.body, styles.sub, { color: colors.inkMuted }]}>
            Anonymous. Judgment-free.{'\n'}Real conversations. When you need it most.
          </Text>
        </View>

        <View style={styles.ctaWrap}>
          <PrimaryButton
            label="Start a Conversation"
            tone="ink"
            icon="chatbubble-outline"
            onPress={() => router.push('/onboarding')}
            accessibilityHint="Begins anonymous onboarding"
            testID="start"
          />
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safe: { flex: 1, paddingHorizontal: space.lg },
  mountains: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  logoZone: { flex: 5, alignItems: 'center', justifyContent: 'flex-end' },
  hero: { flex: 6, alignItems: 'center', justifyContent: 'center', gap: space.md },
  headline: {
    fontFamily: font.sansHeavy,
    fontSize: 32,
    lineHeight: 42,
    textAlign: 'center',
  },
  sub: { textAlign: 'center' },
  ctaWrap: { flex: 4, justifyContent: 'flex-start', paddingTop: space.sm },
});

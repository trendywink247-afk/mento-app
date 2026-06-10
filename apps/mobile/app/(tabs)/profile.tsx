import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/Screen';
import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { getPersona, type Persona } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

/** Profile (companion switcher, preferences, support, contribution) lands in Phase 5. */
export default function ProfileTab() {
  const { colors } = useTheme();
  const [persona, setPersona] = useState<Persona | null>(null);

  useEffect(() => {
    let active = true;
    void getPersona().then((p) => {
      if (active) setPersona(p);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <Screen>
      <Text style={[type.displaySerif, { color: colors.ink }]} accessibilityRole="header">
        Profile
      </Text>
      <View style={styles.empty}>
        <PersonaAvatar name={persona?.persona_name ?? 'Mento'} size={96} />
        <Text style={[type.titleSerif, styles.center, { color: colors.ink }]}>
          {persona?.persona_name ?? 'Anonymous'}
        </Text>
        <Text style={[type.body, styles.center, { color: colors.inkMuted }]}>
          Your identity stays yours. Companion, preferences, and support options are on their
          way here.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
  center: { textAlign: 'center' },
});

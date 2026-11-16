import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressKey } from '@/components/motion/PressKey';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLOR_LABELS, COMPANION_COLORS, type CompanionColor } from '@/theme/companion';
import { radius } from '@/theme/tokens';

const COLOR_KEYS = Object.keys(COMPANION_COLORS) as CompanionColor[];
const SWATCH = 44;
const SWATCH_RING = 5; // the selected swatch's ring sits this far outside it

/** The seven app colours in one row (moved from Profile to the Theme page, DECISIONS S.7).
 * The recolour lands on the device at once (the whole app re-accents) and on the account in
 * the background — a failed save shows nothing and never undoes the choice. */
export function ColourSwatches({ testIDPrefix = 'profile-colour' }: { testIDPrefix?: string }) {
  const { colors, companionColor, setCompanionColor } = useTheme();
  const { t } = useI18n();
  const [swatch, setSwatch] = useState(SWATCH);
  const recolour = (key: CompanionColor) => {
    setCompanionColor(key);
    void api.saveCompanion({ companion_colour: key }).catch(() => {
      /* reason: best-effort sync; the device copy is what the app reads */
    });
  };
  return (
    <View
      style={styles.swatches}
      onLayout={(e) => {
        // Seven 44px keys fit a 390 phone; a 360 one gets slightly smaller keys rather than
        // a second row. The ring's room is part of the sum.
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
              testID={`${testIDPrefix}-${key}`}
              style={{ width: swatch, height: swatch, backgroundColor: set.accent }}
            >
              {null}
            </PressKey>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
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
});

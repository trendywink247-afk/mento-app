import { StyleSheet, Text, View } from 'react-native';

import { Companion } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS, accentFor } from '@/theme/companion';
import { radius, type, wash } from '@/theme/tokens';

/** Initials washes for a member with no companion on hand (board A10 rows: "QJ" on sky,
 * "SM" on sage). Stable per persona name, never the viewer's accent. */
const WASHES = [
  { bg: wash.sky, fg: COMPANION_COLORS.sky.accentEdge },
  { bg: wash.green, fg: COMPANION_COLORS.sage.accentEdge },
  { bg: wash.indigo, fg: COMPANION_COLORS.plum.accentEdge },
  { bg: wash.orange, fg: COMPANION_COLORS.mustard.accentEdge },
  { bg: wash.accent, fg: COMPANION_COLORS.terracotta.accentEdge },
];

function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

/** A member, as a mentor may see them: their persona, and — when the API carries it —
 * their companion standing in a disc of THEIR colour (never the mentor's accent).
 * Decorative: the name beside it is what assistive tech reads. */
export function MemberDisc({
  name,
  size,
  animal,
  colour,
  ring,
}: {
  name: string;
  size: number;
  animal?: string | null;
  colour?: string | null;
  /** A white 2px rim with a hairline outside it (board A35 header). */
  ring?: string;
}) {
  const { colors } = useTheme();
  if (animal) {
    const tint = accentFor(colour).accentTint;
    const disc = (
      <View
        style={[
          styles.disc,
          { width: size, height: size, backgroundColor: tint, justifyContent: 'flex-end' },
          ring ? { borderWidth: 2, borderColor: colors.surface } : null,
        ]}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <Companion animal={animal as CompanionAnimal} size={Math.round(size * 0.92)} awake />
      </View>
    );
    // The hairline sits OUTSIDE the white rim, as the board draws it.
    return ring ? <View style={[styles.ring, { borderColor: ring }]}>{disc}</View> : disc;
  }
  const w = WASHES[hash(name) % WASHES.length];
  return (
    <View
      style={[styles.disc, { width: size, height: size, backgroundColor: w.bg, justifyContent: 'center' }]}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      <Text style={[styles.initials, { color: w.fg, fontSize: Math.round(size * 0.38) }]}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  disc: { borderRadius: radius.pill, overflow: 'hidden', alignItems: 'center' },
  ring: { borderWidth: 1, borderRadius: radius.pill },
  initials: { fontFamily: type.displayHeadline.fontFamily, lineHeight: undefined },
});

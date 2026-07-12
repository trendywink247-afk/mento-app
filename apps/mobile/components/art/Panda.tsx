import { Image } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect, Text as SvgText } from 'react-native-svg';

import { PANDA_POSES } from '@/assets/companions/generated/panda-poses';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * The Mento panda mascot, vector re-creation of the mockups' 3D panda in a flat-rounded
 * style. One base body, posed via overlays. The cape/accessories take the companion
 * accent so the mascot follows the user's theme.
 *
 * Poses used across v1:
 *  - wave     — end-of-conversation reflection header (caped, waving)
 *  - sleep    — reflection slider "drained" endpoint / Panda Pause
 *  - excited  — reflection slider "energized" endpoint
 *  - coffee   — contribution screen (mug raised)
 *  - sad      — wrong-PIN state (droopy ears, "?")
 *  - shield   — report/block ("we take your safety seriously")
 */
export type PandaPose = 'wave' | 'sleep' | 'excited' | 'coffee' | 'sad' | 'shield';

const WHITE = '#FFFFFF';
const BLACK = '#2B2B33';
const BLUSH = '#F3C5C5';

export function Panda({ pose = 'wave', size = 160 }: { pose?: PandaPose; size?: number }) {
  const { colors } = useTheme();
  const accent = colors.accent;

  // Generated pose art (style-matched to the shipped companion set) wins;
  // the coded SVG below stays as the fallback for any pose without an asset.
  const generated = PANDA_POSES[pose];
  if (generated) {
    return (
      <Image
        source={generated}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
        style={{ width: size, height: size }}
      />
    );
  }

  if (pose === 'sleep') return <SleepingPanda size={size} accent={accent} />;

  const droop = pose === 'sad';
  const armsUp = pose === 'excited';
  return (
    <Svg width={size} height={size} viewBox="0 0 160 160">
      {/* cape (wave/excited/coffee) */}
      {(pose === 'wave' || pose === 'excited' || pose === 'coffee') && (
        <Path d="M38 88 Q30 130 44 148 L80 138 116 148 Q130 130 122 88 Q102 78 80 78 Q58 78 38 88 Z" fill={accent} opacity={0.9} />
      )}
      {/* body */}
      <Ellipse cx="80" cy="112" rx="42" ry="36" fill={WHITE} />
      <Ellipse cx="80" cy="124" rx="26" ry="20" fill="#F4F1F6" />
      {/* legs */}
      <Ellipse cx="52" cy="140" rx="14" ry="10" fill={BLACK} />
      <Ellipse cx="108" cy="140" rx="14" ry="10" fill={BLACK} />
      {/* arms */}
      {armsUp ? (
        <>
          <Ellipse cx="38" cy="78" rx="10" ry="16" fill={BLACK} transform="rotate(-35 38 78)" />
          <Ellipse cx="122" cy="78" rx="10" ry="16" fill={BLACK} transform="rotate(35 122 78)" />
        </>
      ) : pose === 'wave' ? (
        <>
          <Ellipse cx="40" cy="74" rx="10" ry="16" fill={BLACK} transform="rotate(-42 40 74)" />
          <Ellipse cx="118" cy="108" rx="10" ry="15" fill={BLACK} transform="rotate(20 118 108)" />
        </>
      ) : pose === 'coffee' ? (
        <>
          <Ellipse cx="44" cy="80" rx="10" ry="15" fill={BLACK} transform="rotate(-50 44 80)" />
          <Ellipse cx="118" cy="108" rx="10" ry="15" fill={BLACK} transform="rotate(20 118 108)" />
        </>
      ) : (
        <>
          <Ellipse cx="44" cy="110" rx="10" ry="15" fill={BLACK} transform="rotate(-18 44 110)" />
          <Ellipse cx="116" cy="110" rx="10" ry="15" fill={BLACK} transform="rotate(18 116 110)" />
        </>
      )}
      {/* head */}
      <Circle cx="80" cy="58" r="38" fill={WHITE} />
      {/* ears */}
      <Circle cx="48" cy={droop ? 36 : 30} r="13" fill={BLACK} />
      <Circle cx="112" cy={droop ? 36 : 30} r="13" fill={BLACK} />
      {/* eye patches */}
      <Ellipse cx="64" cy="58" rx="11" ry="13" fill={BLACK} transform="rotate(-12 64 58)" />
      <Ellipse cx="96" cy="58" rx="11" ry="13" fill={BLACK} transform="rotate(12 96 58)" />
      {/* eyes */}
      {pose === 'wave' ? (
        <>
          {/* wink */}
          <Path d="M59 57 q5 5 10 0" stroke={WHITE} strokeWidth="3" fill="none" strokeLinecap="round" />
          <Circle cx="96" cy="57" r="4.2" fill={WHITE} />
          <Circle cx="97.5" cy="55.5" r="1.5" fill={BLACK} />
        </>
      ) : droop ? (
        <>
          <Circle cx="64" cy="59" r="3.6" fill={WHITE} />
          <Circle cx="96" cy="59" r="3.6" fill={WHITE} />
        </>
      ) : (
        <>
          <Circle cx="64" cy="57" r="4.2" fill={WHITE} />
          <Circle cx="96" cy="57" r="4.2" fill={WHITE} />
          <Circle cx="65.5" cy="55.5" r="1.5" fill={BLACK} />
          <Circle cx="97.5" cy="55.5" r="1.5" fill={BLACK} />
        </>
      )}
      {/* muzzle */}
      <Ellipse cx="80" cy="72" rx="9" ry="6.5" fill={BLACK} opacity={0.95} />
      <Ellipse cx="80" cy="70.5" rx="3.6" ry="2.4" fill={WHITE} opacity={0.25} />
      {droop ? (
        <Path d="M73 84 q7 -6 14 0" stroke={BLACK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      ) : (
        <Path d="M73 80 q7 7 14 0" stroke={BLACK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      )}
      {/* blush */}
      <Ellipse cx="52" cy="70" rx="5" ry="3" fill={BLUSH} />
      <Ellipse cx="108" cy="70" rx="5" ry="3" fill={BLUSH} />
      {/* medallion on cape */}
      {(pose === 'wave' || pose === 'excited' || pose === 'coffee') && (
        <>
          <Circle cx="80" cy="92" r="7" fill="#D9B36A" />
          <SvgText x="80" y="96" fontSize="9" fontWeight="bold" fill={WHITE} textAnchor="middle">
            M
          </SvgText>
        </>
      )}
      {/* pose props */}
      {pose === 'coffee' && (
        <G>
          <Rect x="18" y="48" width="22" height="24" rx="5" fill={accent} />
          <Path d="M40 54 q10 2 0 12" stroke={accent} strokeWidth="4" fill="none" />
          <Path d="M25 60 a5 5 0 0 1 8 0 a4 4 0 0 1 -4 4 a4 4 0 0 1 -4 -4 Z" fill={WHITE} />
          <Path d="M26 42 q3 -6 0 -10 M33 42 q-3 -6 0 -10" stroke="#CFCAE6" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </G>
      )}
      {pose === 'sad' && (
        <SvgText x="128" y="34" fontSize="26" fontWeight="bold" fill={accent} textAnchor="middle">
          ?
        </SvgText>
      )}
      {pose === 'shield' && (
        <G>
          <Path d="M124 84 l16 6 v12 q0 14 -16 20 q-16 -6 -16 -20 v-12 Z" fill={accent} />
          <Path d="M117 102 l5 5 9 -10" stroke={WHITE} strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </G>
      )}
    </Svg>
  );
}

function SleepingPanda({ size, accent }: { size: number; accent: string }) {
  return (
    <Svg width={size} height={size * 0.75} viewBox="0 0 160 120">
      {/* blanket */}
      <Path d="M30 96 Q34 70 80 70 Q126 70 130 96 Q132 110 80 110 Q28 110 30 96 Z" fill={accent} opacity={0.85} />
      {/* head resting */}
      <Circle cx="62" cy="62" r="32" fill={WHITE} />
      <Circle cx="36" cy="40" r="11" fill={BLACK} />
      <Circle cx="88" cy="40" r="11" fill={BLACK} />
      <Ellipse cx="49" cy="62" rx="9.5" ry="11" fill={BLACK} transform="rotate(-12 49 62)" />
      <Ellipse cx="76" cy="62" rx="9.5" ry="11" fill={BLACK} transform="rotate(12 76 62)" />
      <Path d="M45 62 q4 4 8 0 M72 62 q4 4 8 0" stroke={WHITE} strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <Ellipse cx="62" cy="74" rx="7.5" ry="5.5" fill={BLACK} />
      <Path d="M56 82 q6 5 12 0" stroke={BLACK} strokeWidth="2" fill="none" strokeLinecap="round" />
      {/* zzz */}
      <SvgText x="112" y="30" fontSize="18" fontWeight="bold" fill={accent} textAnchor="middle">z</SvgText>
      <SvgText x="124" y="20" fontSize="13" fontWeight="bold" fill={accent} opacity={0.7} textAnchor="middle">z</SvgText>
      <SvgText x="133" y="12" fontSize="9" fontWeight="bold" fill={accent} opacity={0.5} textAnchor="middle">z</SvgText>
    </Svg>
  );
}

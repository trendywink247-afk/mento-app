import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

/**
 * Soft scene illustrations matching the mockups' style: lavender washes, rounded
 * shapes, sparkles + leaves. All flat vector so they stay crisp and theme-friendly.
 */

const LAV_1 = '#CFCAE6';
const LAV_2 = '#E2DEF3';
const LAV_3 = '#B7AEDF';
const PURPLE = '#8B7FD6';
const INK = '#1D2142';
const SKIN = '#E8B89B';

/** Sparkle four-point star. */
function Sparkle({ x, y, s, fill = LAV_3 }: { x: number; y: number; s: number; fill?: string }) {
  return (
    <Path
      d={`M${x} ${y - s} Q${x + s * 0.2} ${y - s * 0.2} ${x + s} ${y} Q${x + s * 0.2} ${y + s * 0.2} ${x} ${y + s} Q${x - s * 0.2} ${y + s * 0.2} ${x - s} ${y} Q${x - s * 0.2} ${y - s * 0.2} ${x} ${y - s} Z`}
      fill={fill}
    />
  );
}

/** Leafy sprig (used beside windows / cards in the mockups). */
function Sprig({ x, y, flip = false }: { x: number; y: number; flip?: boolean }) {
  const dir = flip ? -1 : 1;
  return (
    <G>
      <Path
        d={`M${x} ${y} q${6 * dir} -18 ${2 * dir} -36`}
        stroke={LAV_3}
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      {[0, 1, 2].map((i) => (
        <Ellipse
          key={i}
          cx={x + dir * (7 + i * 2)}
          cy={y - 8 - i * 11}
          rx="6"
          ry="3.5"
          fill={LAV_2}
          transform={`rotate(${dir * -30} ${x + dir * (7 + i * 2)} ${y - 8 - i * 11})`}
        />
      ))}
    </G>
  );
}

/** Landing footer: layered lavender mountains. Render full-width, ~180 tall. */
export function MountainsScene({ width = 400, height = 180 }: { width?: number; height?: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 400 180" preserveAspectRatio="xMidYMax slice">
      <Path d="M0 180 V120 Q60 70 130 110 Q200 150 260 105 Q330 55 400 100 V180 Z" fill={LAV_2} />
      <Path d="M0 180 V150 Q80 105 160 140 Q250 178 330 135 Q370 115 400 130 V180 Z" fill={LAV_1} />
      <Path d="M0 180 V168 Q110 135 220 165 Q310 188 400 158 V180 Z" fill={LAV_3} opacity={0.8} />
      {/* birds */}
      <Path d="M318 38 q5 -5 10 0 q5 -5 10 0" stroke={LAV_3} strokeWidth="2" fill="none" strokeLinecap="round" />
      <Path d="M345 56 q4 -4 8 0 q4 -4 8 0" stroke={LAV_3} strokeWidth="2" fill="none" strokeLinecap="round" />
    </Svg>
  );
}

/** Connecting screen: two people in arched windows with a chat bubble between. */
export function ConnectingScene({ width = 340, height = 170 }: { width?: number; height?: number }) {
  return (
    <Svg width={width} height={height} viewBox="0 0 340 170">
      {/* left arched window */}
      <Path d="M20 160 V70 q0 -50 50 -50 q50 0 50 50 v90 Z" fill={LAV_2} />
      <Rect x="14" y="155" width="112" height="8" rx="4" fill={LAV_1} />
      {/* left person (purple sweater, mug) */}
      <Circle cx="70" cy="78" r="16" fill={SKIN} />
      <Path d="M56 70 q-4 -16 14 -16 q18 0 14 16 q-2 -8 -14 -8 q-12 0 -14 8 Z" fill={INK} />
      <Path d="M40 160 v-30 q0 -26 30 -26 q30 0 30 26 v30 Z" fill={PURPLE} />
      <Path d="M62 132 q8 8 16 0 l4 8 h-24 Z" fill={PURPLE} />
      <Rect x="74" y="124" width="13" height="15" rx="4" fill={INK} />
      {/* right arched window */}
      <Path d="M220 160 V70 q0 -50 50 -50 q50 0 50 50 v90 Z" fill={LAV_2} />
      <Rect x="214" y="155" width="112" height="8" rx="4" fill={LAV_1} />
      {/* right person (long hair, cup) */}
      <Circle cx="270" cy="80" r="15" fill={SKIN} />
      <Path d="M252 96 q-6 -34 18 -34 q24 0 18 34 q-4 -6 -6 -16 q-6 8 -24 6 q-2 6 -6 10 Z" fill={INK} />
      <Path d="M240 160 v-28 q0 -26 30 -26 q30 0 30 26 v28 Z" fill={LAV_3} />
      <Rect x="258" y="126" width="12" height="14" rx="4" fill="#FFFFFF" />
      {/* dashed connection + bubble */}
      <Path d="M126 96 Q150 88 162 92" stroke={LAV_3} strokeWidth="2.5" strokeDasharray="2 7" fill="none" strokeLinecap="round" />
      <Path d="M214 96 Q190 88 178 92" stroke={LAV_3} strokeWidth="2.5" strokeDasharray="2 7" fill="none" strokeLinecap="round" />
      <Circle cx="170" cy="88" r="22" fill="#FFFFFF" />
      <Path d="M156 88 a14 12 0 1 1 18 11 l-8 6 1 -8 a14 12 0 0 1 -11 -9 Z" fill={PURPLE} />
      <Circle cx="165" cy="87" r="2" fill="#FFFFFF" />
      <Circle cx="171" cy="87" r="2" fill="#FFFFFF" />
      <Circle cx="177" cy="87" r="2" fill="#FFFFFF" />
      <Sparkle x={150} y={55} s={5} />
      <Sparkle x={196} y={120} s={4} />
      <Sparkle x={130} y={130} s={3} fill={LAV_2} />
      <Sprig x={12} y={165} />
      <Sprig x={328} y={165} flip />
    </Svg>
  );
}

/** Chat empty state: two overlapping chat bubbles + sprig + sparkles. */
export function ChatBubblesScene({ size = 150 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 0.8} viewBox="0 0 150 120">
      <Path d="M30 18 h58 a22 22 0 0 1 22 22 v10 a22 22 0 0 1 -22 22 h-30 l-16 14 2 -14 h-14 a22 22 0 0 1 -22 -22 v-10 a22 22 0 0 1 22 -22 Z" fill={LAV_3} opacity={0.9} />
      <Circle cx="52" cy="45" r="4" fill="#FFFFFF" />
      <Circle cx="70" cy="45" r="4" fill="#FFFFFF" />
      <Circle cx="88" cy="45" r="4" fill="#FFFFFF" />
      <Path d="M88 62 h28 a16 16 0 0 1 16 16 v6 a16 16 0 0 1 -16 16 h-8 l10 12 -20 -12 h-10 a16 16 0 0 1 -16 -16 v-6 a16 16 0 0 1 16 -16 Z" fill={LAV_2} />
      <Circle cx="96" cy="81" r="3" fill={LAV_3} />
      <Circle cx="106" cy="81" r="3" fill={LAV_3} />
      <Circle cx="116" cy="81" r="3" fill={LAV_3} />
      <Sparkle x={128} y={28} s={5} />
      <Sparkle x={16} y={80} s={4} />
      <Sparkle x={140} y={58} s={3} fill={LAV_2} />
      <Sprig x={10} y={112} />
    </Svg>
  );
}

export { Sparkle, Sprig };

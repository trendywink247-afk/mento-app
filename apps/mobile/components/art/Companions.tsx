import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';

/**
 * The six growth-companion animals (mockup #58) as flat-rounded vector portraits.
 * Consistent style: big head, soft shapes, no outlines — crisp on the white picker
 * cards at any scale.
 */
export type CompanionAnimal =
  | 'Panda'
  | 'Elephant'
  | 'Fox'
  | 'Turtle'
  | 'Deer'
  | 'Owl'
  | 'Dog'
  | 'Cat'
  | 'Capybara';

export function CompanionArt({ animal, size = 72 }: { animal: CompanionAnimal; size?: number }) {
  switch (animal) {
    case 'Panda':
      return <PandaFace size={size} />;
    case 'Elephant':
      return <ElephantFace size={size} />;
    case 'Fox':
      return <FoxFace size={size} />;
    case 'Turtle':
      return <TurtleFace size={size} />;
    case 'Deer':
      return <DeerFace size={size} />;
    case 'Owl':
      return <OwlFace size={size} />;
    default:
      // Dog / Cat / Capybara (2026-09-19) ship painterly art only — no coded portrait.
      return <PandaFace size={size} />;
  }
}

const INK = '#2B2B33';

function PandaFace({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 80 80">
      <Circle cx="18" cy="16" r="11" fill={INK} />
      <Circle cx="62" cy="16" r="11" fill={INK} />
      <Circle cx="40" cy="44" r="30" fill="#FFFFFF" />
      <Ellipse cx="28" cy="42" rx="8.5" ry="10" fill={INK} transform="rotate(-12 28 42)" />
      <Ellipse cx="52" cy="42" rx="8.5" ry="10" fill={INK} transform="rotate(12 52 42)" />
      <Circle cx="28" cy="41" r="3.2" fill="#FFFFFF" />
      <Circle cx="52" cy="41" r="3.2" fill="#FFFFFF" />
      <Circle cx="29" cy="40" r="1.2" fill={INK} />
      <Circle cx="53" cy="40" r="1.2" fill={INK} />
      <Ellipse cx="40" cy="54" rx="6.5" ry="4.5" fill={INK} />
      <Path d="M34 60 q6 5 12 0" stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" />
      <Ellipse cx="18" cy="52" rx="4" ry="2.5" fill="#F3C5C5" />
      <Ellipse cx="62" cy="52" rx="4" ry="2.5" fill="#F3C5C5" />
    </Svg>
  );
}

function ElephantFace({ size }: { size: number }) {
  const grey = '#A9AEC3';
  const dark = '#8C92AC';
  return (
    <Svg width={size} height={size} viewBox="0 0 80 80">
      <Ellipse cx="14" cy="38" rx="13" ry="16" fill={dark} />
      <Ellipse cx="66" cy="38" rx="13" ry="16" fill={dark} />
      <Ellipse cx="14" cy="38" rx="8" ry="11" fill="#C9CCDD" />
      <Ellipse cx="66" cy="38" rx="8" ry="11" fill="#C9CCDD" />
      <Circle cx="40" cy="40" r="27" fill={grey} />
      <Circle cx="31" cy="34" r="3.4" fill={INK} />
      <Circle cx="49" cy="34" r="3.4" fill={INK} />
      <Circle cx="32" cy="33" r="1.1" fill="#FFFFFF" />
      <Circle cx="50" cy="33" r="1.1" fill="#FFFFFF" />
      <Path d="M40 44 q-7 14 2 24 q5 5 10 1" stroke={dark} strokeWidth="11" fill="none" strokeLinecap="round" />
      <Ellipse cx="26" cy="46" rx="4" ry="2.5" fill="#F3C5C5" />
      <Ellipse cx="54" cy="46" rx="4" ry="2.5" fill="#F3C5C5" />
    </Svg>
  );
}

function FoxFace({ size }: { size: number }) {
  const orange = '#E8854B';
  const cream = '#FBEFE2';
  return (
    <Svg width={size} height={size} viewBox="0 0 80 80">
      <Path d="M12 10 L30 24 14 36 Z" fill={orange} />
      <Path d="M68 10 L50 24 66 36 Z" fill={orange} />
      <Path d="M16 14 L27 23 17 30 Z" fill={INK} opacity={0.7} />
      <Path d="M64 14 L53 23 63 30 Z" fill={INK} opacity={0.7} />
      <Path d="M40 70 Q12 62 13 38 Q14 20 40 20 Q66 20 67 38 Q68 62 40 70 Z" fill={orange} />
      <Path d="M40 70 Q26 65 24 50 h32 Q54 65 40 70 Z" fill={cream} />
      <Circle cx="29" cy="40" r="3.4" fill={INK} />
      <Circle cx="51" cy="40" r="3.4" fill={INK} />
      <Path d="M36 55 l4 4 4 -4" stroke={INK} strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Ellipse cx="40" cy="53" rx="4" ry="3" fill={INK} />
    </Svg>
  );
}

function TurtleFace({ size }: { size: number }) {
  const green = '#6FAE6A';
  const shell = '#4E8B57';
  return (
    <Svg width={size} height={size} viewBox="0 0 80 80">
      <Circle cx="40" cy="46" r="28" fill={shell} />
      <Circle cx="40" cy="46" r="20" fill="#5FA065" />
      <Path d="M40 26 v40 M21 36 l38 20 M59 36 l-38 20" stroke={shell} strokeWidth="3" />
      <Circle cx="40" cy="22" r="14" fill={green} />
      <Circle cx="35" cy="20" r="2.8" fill={INK} />
      <Circle cx="45" cy="20" r="2.8" fill={INK} />
      <Path d="M36 27 q4 3 8 0" stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" />
      <Ellipse cx="14" cy="56" rx="7" ry="5" fill={green} />
      <Ellipse cx="66" cy="56" rx="7" ry="5" fill={green} />
    </Svg>
  );
}

function DeerFace({ size }: { size: number }) {
  const tan = '#C99B6A';
  const cream = '#F4E3CE';
  const antler = '#9A7B52';
  return (
    <Svg width={size} height={size} viewBox="0 0 80 80">
      <Path d="M20 26 Q12 18 14 6 M20 26 Q24 14 18 10 M60 26 Q68 18 66 6 M60 26 Q56 14 62 10" stroke={antler} strokeWidth="4" fill="none" strokeLinecap="round" />
      <Ellipse cx="16" cy="32" rx="9" ry="6" fill={tan} transform="rotate(-30 16 32)" />
      <Ellipse cx="64" cy="32" rx="9" ry="6" fill={tan} transform="rotate(30 64 32)" />
      <Path d="M40 72 Q16 64 18 42 Q20 24 40 24 Q60 24 62 42 Q64 64 40 72 Z" fill={tan} />
      <Ellipse cx="40" cy="58" rx="13" ry="11" fill={cream} />
      <Circle cx="30" cy="42" r="3.4" fill={INK} />
      <Circle cx="50" cy="42" r="3.4" fill={INK} />
      <Ellipse cx="40" cy="55" rx="4.5" ry="3.2" fill={INK} />
      <Path d="M35 63 q5 4 10 0" stroke={INK} strokeWidth="2" fill="none" strokeLinecap="round" />
    </Svg>
  );
}

function OwlFace({ size }: { size: number }) {
  const brown = '#A77B4E';
  const cream = '#EFDEC4';
  return (
    <Svg width={size} height={size} viewBox="0 0 80 80">
      <Path d="M18 16 L28 28 14 30 Z" fill={brown} />
      <Path d="M62 16 L52 28 66 30 Z" fill={brown} />
      <Circle cx="40" cy="44" r="29" fill={brown} />
      <Path d="M40 73 Q18 68 14 48 a13 13 0 0 0 13 -8 a14 14 0 0 0 26 0 a13 13 0 0 0 13 8 Q62 68 40 73 Z" fill={cream} opacity={0.5} />
      <Circle cx="29" cy="40" r="9.5" fill={cream} />
      <Circle cx="51" cy="40" r="9.5" fill={cream} />
      <Circle cx="29" cy="40" r="4.4" fill={INK} />
      <Circle cx="51" cy="40" r="4.4" fill={INK} />
      <Circle cx="30.5" cy="38.5" r="1.4" fill="#FFFFFF" />
      <Circle cx="52.5" cy="38.5" r="1.4" fill="#FFFFFF" />
      <Path d="M36 47 L40 54 L44 47 Z" fill="#E0A23E" />
      <Rect x="32" y="64" width="5" height="6" rx="2.5" fill="#E0A23E" />
      <Rect x="43" y="64" width="5" height="6" rx="2.5" fill="#E0A23E" />
    </Svg>
  );
}

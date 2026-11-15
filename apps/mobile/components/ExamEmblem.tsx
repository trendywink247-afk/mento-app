import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import type { ExamBadges } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Exam badges as emblems (DECISIONS R.15): a round coin with a thin ring, a laurel on both
 * sides, a serif letter and a small line icon under it — P with an open book (Prelims),
 * M with a pillared building (Mains), I with a microphone (Interview). A small circle joined
 * to the ring at the top right holds how many times. Soft grey, low contrast: subtle,
 * never prominent. `compact` (lists) is ring + letter + count only; the full emblem is for
 * the mentor's profile page. Shown only once an admin has checked the mentor's proof.
 */
type Stage = 'prelims' | 'mains' | 'interview';
const LETTER: Record<Stage, string> = { prelims: 'P', mains: 'M', interview: 'I' };
const STAGES: Stage[] = ['prelims', 'mains', 'interview'];

function Book({ c }: { c: string }) {
  return (
    <G stroke={c} strokeWidth={1.1} fill="none" strokeLinejoin="round">
      <Path d="M43 66 q-4.5 -2 -9 0 v-6 q4.5 -2 9 0 z" />
      <Path d="M43 66 q4.5 -2 9 0 v-6 q-4.5 -2 -9 0 z" />
    </G>
  );
}

function Pillars({ c }: { c: string }) {
  return (
    <G stroke={c} strokeWidth={1.1} fill="none" strokeLinejoin="round">
      <Path d="M35 61 L43 57 L51 61 Z" />
      <Line x1={37} y1={62} x2={37} y2={67} />
      <Line x1={41} y1={62} x2={41} y2={67} />
      <Line x1={45} y1={62} x2={45} y2={67} />
      <Line x1={49} y1={62} x2={49} y2={67} />
      <Line x1={35} y1={68} x2={51} y2={68} />
    </G>
  );
}

function Mic({ c }: { c: string }) {
  return (
    <G stroke={c} strokeWidth={1.1} fill="none" strokeLinecap="round">
      <Rect x={41} y={56.5} width={4} height={7} rx={2} />
      <Path d="M38.8 61.5 q0 4.5 4.2 4.5 q4.2 0 4.2 -4.5" />
      <Line x1={43} y1={66} x2={43} y2={68.5} />
    </G>
  );
}

/** One side of the wreath: a stem curving up the coin's edge with five small leaves. */
function Laurel({ c, flip }: { c: string; flip?: boolean }) {
  const leaves = [0, 1, 2, 3, 4].map((i) => {
    const a = (200 - i * 22) * (Math.PI / 180);
    const x = 43 + 27 * Math.cos(a);
    const y = 44 - 27 * Math.sin(a);
    const rot = 200 - i * 22 - 90;
    return <Path key={i} d="M0 0 q2.6 -3 0 -6.5 q-2.6 3.5 0 6.5 z" fill={c} transform={`translate(${x} ${y}) rotate(${-rot})`} />;
  });
  return (
    <G transform={flip ? 'translate(86 0) scale(-1 1)' : undefined} opacity={0.85}>
      <Path d="M24 64 A27 27 0 0 1 20 30" stroke={c} strokeWidth={0.9} fill="none" />
      {leaves}
    </G>
  );
}

export function ExamEmblem({ stage, count, size = 44, compact = false }: { stage: Stage; count: number; size?: number; compact?: boolean }) {
  const { colors } = useTheme();
  const grey = colors.inkMuted;
  const faint = colors.border;
  // The coin sits in an 86×86 box; the count bubble overhangs the top right.
  return (
    <Svg width={size} height={size} viewBox="0 0 92 92" accessible={false}>
      <Circle cx={43} cy={47} r={compact ? 30 : 33} fill={colors.surface} stroke={grey} strokeWidth={1.4} opacity={0.9} />
      {!compact ? <Circle cx={43} cy={47} r={29} fill="none" stroke={faint} strokeWidth={1} /> : null}
      {!compact ? (
        <G transform="translate(0 3)">
          <Laurel c={grey} />
          <Laurel c={grey} flip />
        </G>
      ) : null}
      <SvgText
        x={43}
        y={compact ? 58 : 54}
        fontSize={compact ? 30 : 24}
        fontFamily="serif"
        fontWeight="600"
        fill={grey}
        textAnchor="middle"
      >
        {LETTER[stage]}
      </SvgText>
      {!compact ? (
        <G transform="translate(0 3)">{stage === 'prelims' ? <Book c={grey} /> : stage === 'mains' ? <Pillars c={grey} /> : <Mic c={grey} />}</G>
      ) : null}
      {count > 0 ? (
        <G>
          <Line x1={64} y1={26} x2={70} y2={20} stroke={grey} strokeWidth={1.4} />
          <Circle cx={75} cy={16} r={13} fill={colors.surface} stroke={grey} strokeWidth={1.4} />
          <SvgText x={75} y={21.5} fontSize={15} fontWeight="700" fill={grey} textAnchor="middle">
            {String(Math.min(count, 99))}
          </SvgText>
        </G>
      ) : null}
    </Svg>
  );
}

/** The row of emblems a mentor has earned (stages with a count above zero), with one
 * accessible label: "Prelims 3 times, Mains 2 times, Interview once". */
export function ExamEmblems({ badges, size, compact, testID }: { badges: ExamBadges | null | undefined; size?: number; compact?: boolean; testID?: string }) {
  const { t } = useI18n();
  if (!badges) return null;
  const shown = STAGES.filter((s) => (badges[s] ?? 0) > 0);
  if (shown.length === 0) return null;
  const label = shown.map((s) => t('emblem.a11y', { stage: t(`emblem.${s}`), count: String(badges[s]) })).join(', ');
  return (
    <View style={styles.row} accessible accessibilityLabel={label} testID={testID}>
      {shown.map((s) => (
        <ExamEmblem key={s} stage={s} count={badges[s]} size={size} compact={compact} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});

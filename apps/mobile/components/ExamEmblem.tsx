import { StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import type { ExamBadges } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';

/**
 * Exam badges as emblems (DECISIONS R.15): a round coin with a thin ring, a laurel on both
 * sides, a serif letter and a small line icon under it — P with an open book (Prelims),
 * M with a pillared building (Mains), I with a microphone (Interview). A small circle joined
 * to the ring at the top right holds how many times. Grey and quiet, but readable: the
 * founder found the first, fainter draw hard to see and asked for the full decoration in
 * lists too (2026-11-15), so `compact` is kept for callers but draws the same emblem.
 * Shown only once an admin has checked the mentor's proof.
 */
type Stage = 'prelims' | 'mains' | 'interview';
const LETTER: Record<Stage, string> = { prelims: 'P', mains: 'M', interview: 'I' };
const STAGES: Stage[] = ['prelims', 'mains', 'interview'];

const ICON_STROKE = 1.6;

function Book({ c }: { c: string }) {
  return (
    <G stroke={c} strokeWidth={ICON_STROKE} fill="none" strokeLinejoin="round">
      <Path d="M43 68 q-5 -2.2 -10 0 v-7 q5 -2.2 10 0 z" />
      <Path d="M43 68 q5 -2.2 10 0 v-7 q-5 -2.2 -10 0 z" />
    </G>
  );
}

function Pillars({ c }: { c: string }) {
  return (
    <G stroke={c} strokeWidth={ICON_STROKE} fill="none" strokeLinejoin="round" strokeLinecap="round">
      <Path d="M34 61.5 L43 57 L52 61.5 Z" />
      <Line x1={36.5} y1={63} x2={36.5} y2={68} />
      <Line x1={41} y1={63} x2={41} y2={68} />
      <Line x1={45} y1={63} x2={45} y2={68} />
      <Line x1={49.5} y1={63} x2={49.5} y2={68} />
      <Line x1={34} y1={69.5} x2={52} y2={69.5} />
    </G>
  );
}

function Mic({ c }: { c: string }) {
  return (
    <G stroke={c} strokeWidth={ICON_STROKE} fill="none" strokeLinecap="round">
      <Rect x={40.5} y={56} width={5} height={8} rx={2.5} />
      <Path d="M37.8 61.5 q0 5.2 5.2 5.2 q5.2 0 5.2 -5.2" />
      <Line x1={43} y1={66.7} x2={43} y2={70} />
    </G>
  );
}

/** One side of the wreath: a stem curving up the coin's edge with seven leaves, tips upward. */
function Laurel({ c, flip }: { c: string; flip?: boolean }) {
  const leaves = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const deg = 236 - i * 19;
    const a = deg * (Math.PI / 180);
    const x = 43 + 26 * Math.cos(a);
    const y = 47 - 26 * Math.sin(a);
    // Each leaf leans along the stem, toward the top of the coin.
    const rot = -(deg - 90) + 180 + 25;
    const scale = 1.25 - i * 0.05;
    return (
      <Path
        key={i}
        d="M0 0 q3.2 -3.4 0 -8 q-3.2 4.6 0 8 z"
        fill={c}
        transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rot.toFixed(1)}) scale(${scale.toFixed(2)})`}
      />
    );
  });
  return (
    <G transform={flip ? 'translate(86 0) scale(-1 1)' : undefined}>
      <Path d="M30.5 70 A26 26 0 0 1 22.5 31" stroke={c} strokeWidth={1.3} fill="none" strokeLinecap="round" />
      {leaves}
    </G>
  );
}

export function ExamEmblem({ stage, count, size = 44 }: { stage: Stage; count: number; size?: number; compact?: boolean }) {
  const { colors } = useTheme();
  // Grey, not a colour: visible but quiet (founder 2026-11-15: the first draw was too faint).
  const grey = colors.inkMuted;
  return (
    <Svg width={size} height={size} viewBox="0 0 92 92" accessible={false}>
      <Circle cx={43} cy={47} r={34} fill={colors.surfaceAlt} stroke={grey} strokeWidth={2.2} />
      <Circle cx={43} cy={47} r={30.5} fill="none" stroke={grey} strokeWidth={1} opacity={0.55} />
      <Laurel c={grey} />
      <Laurel c={grey} flip />
      <SvgText x={43} y={53} fontSize={23} fontFamily="serif" fontWeight="700" fill={colors.ink} opacity={0.72} textAnchor="middle">
        {LETTER[stage]}
      </SvgText>
      {stage === 'prelims' ? <Book c={grey} /> : stage === 'mains' ? <Pillars c={grey} /> : <Mic c={grey} />}
      {count > 0 ? (
        <G>
          <Line x1={66} y1={24} x2={70} y2={20} stroke={grey} strokeWidth={2.2} />
          <Circle cx={76} cy={15} r={13} fill={grey} stroke={colors.surface} strokeWidth={1.5} />
          <SvgText x={76} y={20.5} fontSize={16} fontWeight="700" fill={colors.surface} textAnchor="middle">
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

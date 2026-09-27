/**
 * The Conversation options sheet (board A20): an oat sheet with a 28px crown rising over the
 * settled-back chat. Rows as drawn — Lock with a PIN · Away Mask (switch) · Quiet Pause
 * (switch) · Save to Journal · Report or block — then the "End conversation · two ways"
 * card: End (the chat closes, saved notes stay) and End and wipe (deleted from this device
 * and from our servers), each with its one line of truth.
 *
 * Money never appears inside a conversation (T&S #4): there is NO contribution row here.
 *
 * Motion: the sheet's rise reads the ONE shared value that also settles the chat back and
 * fades the scrim (components/motion/useSheetDepth.ts); its rows then arrive in reading
 * order. Reduced motion: a plain fade, rows simply there. Transform + opacity only.
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EdgeSurface } from '@/components/EdgeSurface';
import { IconBadge } from '@/components/IconBadge';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { useFrameSize } from '@/lib/useFrameSize';
import { duration, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, wash, type Wash } from '@/theme/tokens';

export type SheetChoice = 'lock' | 'status' | 'pause' | 'save' | 'report' | 'end' | 'wipe';

const CROWN = 28;
const SWITCH_TRAVEL = 16;

/** The board's little switch: a 40×24 track, a white knob that slides 16px. */
function Switch({ on, reduced }: { on: boolean; reduced: boolean }) {
  const { colors } = useTheme();
  const x = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    x.value = reduced ? (on ? 1 : 0) : withTiming(on ? 1 : 0, { duration: duration.fast, easing: easing.settle });
  }, [on, reduced, x]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: SWITCH_TRAVEL * x.value }] }));
  return (
    <View style={[styles.track, { backgroundColor: on ? colors.accent : colors.dotIdle }]}>
      <Animated.View style={[styles.knob, { backgroundColor: colors.surface }, knob]} />
    </View>
  );
}

function Row({
  icon,
  tone,
  title,
  body,
  onPress,
  testID,
  switchOn,
  reduced,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: Wash;
  title: string;
  body: string;
  onPress: () => void;
  testID: string;
  /** Given = this row is a switch (board: Away Mask, Quiet Pause); else it opens something. */
  switchOn?: boolean;
  reduced: boolean;
}) {
  const { colors } = useTheme();
  const isSwitch = switchOn !== undefined;
  return (
    <PressKey
      onPress={onPress}
      edge={colors.edgeSurface}
      radius={radius.md}
      intent={isSwitch ? 'toggle' : 'navigate'}
      accessibilityRole={isSwitch ? 'switch' : 'button'}
      accessibilityState={isSwitch ? { checked: switchOn } : undefined}
      accessibilityLabel={`${title}. ${body}`}
      testID={testID}
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <IconBadge icon={icon} tone={tone} size={36} />
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: colors.ink }]}>{title}</Text>
        <Text style={[type.caption, { color: colors.inkMuted }]}>{body}</Text>
      </View>
      {isSwitch ? (
        <Switch on={switchOn} reduced={reduced} />
      ) : (
        <Ionicons name="chevron-forward" size={20} color={colors.inkMuted} />
      )}
    </PressKey>
  );
}

type Props = {
  locked: boolean;
  maskOn: boolean;
  paused: boolean;
  /** End is on its way to the server: both End keys rest. */
  busy: boolean;
  /** A switch or End could not be saved — one still line, nothing shakes. */
  error: string | null;
  onChoose: (c: SheetChoice) => void;
  onClose: () => void;
  progress: SharedValue<number>;
  reduced: boolean;
};

export function OptionsSheet({ locked, maskOn, paused, busy, error, onChoose, onClose, progress, reduced }: Props) {
  const { colors, elevation } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { height: frame } = useFrameSize();
  // Until it has been measured the sheet waits a full frame below, so it can never flash.
  const sheetHeight = useSharedValue(frame);

  const rise = useAnimatedStyle(() =>
    reduced
      ? { opacity: progress.value, transform: [{ translateY: 0 }] }
      : { opacity: 1, transform: [{ translateY: (1 - progress.value) * sheetHeight.value }] },
  );

  return (
    <Animated.View
      onLayout={(e) => {
        sheetHeight.value = e.nativeEvent.layout.height;
      }}
      style={[
        styles.sheet,
        elevation.lg,
        { backgroundColor: colors.bg, maxHeight: frame - space.xl, paddingBottom: 28 + insets.bottom },
        rise,
      ]}
      testID="options-sheet"
      accessibilityViewIsModal
      accessibilityLabel={t('chat.optionsA11y')}
    >
      <View style={[styles.handle, { backgroundColor: colors.edgeAlt }]} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
              {t('options.sheet.title')}
              <Text style={{ color: colors.accent }}>{t('chatOptions.titleAccent')}</Text>
            </Text>
            <Text style={[type.note, { color: colors.inkMuted }]}>{t('options.sheet.sub')}</Text>
          </View>
          <PressKey
            onPress={onClose}
            edge={colors.edgeSurface}
            radius={radius.pill}
            accessibilityLabel={t('options.sheet.closeA11y')}
            testID="options-close"
            style={[styles.close, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Ionicons name="close" size={20} color={colors.ink} />
          </PressKey>
        </View>

        <Entrance index={2}>
          <Row
            icon="lock-closed-outline"
            tone="accent"
            title={t(locked ? 'options.sheet.unlock' : 'options.sheet.lock')}
            body={t('options.sheet.lockBody')}
            onPress={() => onChoose('lock')}
            testID="opt-lock"
            reduced={reduced}
          />
        </Entrance>
        <Entrance index={3} style={styles.pair}>
          <Row
            icon="moon-outline"
            tone="indigo"
            title={t('options.sheet.status')}
            body={t('options.sheet.statusBody')}
            onPress={() => onChoose('status')}
            testID="opt-status"
            switchOn={maskOn}
            reduced={reduced}
          />
          <Row
            icon="notifications-off-outline"
            tone="orange"
            title={t('options.sheet.pause')}
            body={t('options.sheet.pauseBody')}
            onPress={() => onChoose('pause')}
            testID="opt-pause"
            switchOn={paused}
            reduced={reduced}
          />
        </Entrance>
        <Entrance index={4}>
          <Row
            icon="bookmark-outline"
            tone="green"
            title={t('chatOptions.save')}
            body={t('chatOptions.saveBody')}
            onPress={() => onChoose('save')}
            testID="opt-save"
            reduced={reduced}
          />
        </Entrance>
        <Entrance index={5}>
          <Row
            icon="alert-circle-outline"
            tone="danger"
            title={t('options.sheet.report')}
            body={t('options.sheet.reportBody')}
            onPress={() => onChoose('report')}
            testID="opt-report"
            reduced={reduced}
          />
        </Entrance>

        <Entrance index={6}>
          <EdgeSurface
            edge={colors.edgeAlt}
            travel={3}
            radius={radius.lg}
            style={[styles.endCard, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
          >
            <View style={styles.endHead}>
              <Ionicons name="leaf-outline" size={16} color={colors.inkMuted} />
              <Text style={[styles.endHeadText, { color: colors.inkMuted }]} accessibilityRole="header">
                {t('chatOptions.endSection')}
              </Text>
            </View>
            {error ? (
              <Text style={[type.caption, { color: colors.danger }]} testID="options-error">
                {error}
              </Text>
            ) : null}
            <PressKey
              onPress={() => onChoose('end')}
              edge={colors.edgeSurface}
              radius={radius.md}
              intent="commit"
              disabled={busy}
              accessibilityLabel={`${t('options.sheet.end')}. ${t('options.sheet.endBody')}`}
              testID="opt-end"
              style={[styles.endKey, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: colors.ink }]}>{t('options.sheet.end')}</Text>
                <Text style={[type.caption, { color: colors.inkMuted }]}>{t('options.sheet.endBody')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.inkMuted} />
            </PressKey>
            <PressKey
              onPress={() => onChoose('wipe')}
              edge={colors.dangerWashEdge}
              radius={radius.md}
              intent="navigate"
              disabled={busy}
              accessibilityLabel={`${t('chatOptions.endWipe')}. ${t('chatOptions.endWipeBody')}`}
              testID="opt-end-wipe"
              style={[styles.endKey, styles.wipeKey, { backgroundColor: wash.danger, borderColor: colors.dangerWashBorder }]}
            >
              <View style={styles.rowText}>
                <Text style={[styles.rowTitle, { color: colors.dangerInk }]}>{t('chatOptions.endWipe')}</Text>
                <Text style={[type.caption, { color: colors.dangerInk }]}>{t('chatOptions.endWipeBody')}</Text>
              </View>
              <Ionicons name="trash-outline" size={20} color={colors.dangerInk} />
            </PressKey>
          </EdgeSurface>
        </Entrance>
      </ScrollView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopLeftRadius: CROWN,
    borderTopRightRadius: CROWN,
    paddingTop: 10,
  },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: radius.pill },
  body: { paddingHorizontal: space.lg, paddingTop: 10, gap: 10 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: space.xs },
  titleText: { flex: 1, minWidth: 0 },
  title: { fontFamily: font.sansHeavy, fontSize: 24, lineHeight: 32 },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  pair: { gap: 10 },
  row: {
    minHeight: 56,
    paddingVertical: space.sm,
    paddingLeft: 12,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 20 },
  track: { width: 40, height: 24, padding: 3, borderRadius: radius.pill, marginRight: 2 },
  knob: { width: 18, height: 18, borderRadius: radius.pill },
  endCard: { paddingTop: 10, paddingHorizontal: 12, paddingBottom: 14, gap: 10, borderWidth: 1 },
  endHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  endHeadText: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18, letterSpacing: 0.5, textTransform: 'uppercase' },
  endKey: {
    minHeight: 56,
    paddingVertical: space.sm,
    paddingLeft: 14,
    paddingRight: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
  },
  wipeKey: { minHeight: 64 },
});

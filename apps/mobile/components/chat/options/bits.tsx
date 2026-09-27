import Ionicons from '@expo/vector-icons/Ionicons';
import { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconBadge } from '@/components/IconBadge';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, type Wash } from '@/theme/tokens';

/** Shared building blocks for the Conversation Options sub-flows (mockups #21–#27):
 * full-overlay screen chrome, radio rows, info rows, the PIN pad, and the
 * celebration/confirm modal. */

export function FlowScreen({
  title,
  subtitle,
  icon,
  onBack,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onBack: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <SafeAreaView style={[styles.flow, { backgroundColor: colors.bgLavender }]} edges={['top', 'bottom']}>
      <View style={styles.flowHeader}>
        <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')} testID="opt-back">
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </Pressable>
        {icon ? <IconBadge icon={icon} size={40} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={[styles.flowTitle, { color: colors.ink }]}>{title}</Text>
          {subtitle ? <Text style={[type.caption, { color: colors.inkMuted }]}>{subtitle}</Text> : null}
        </View>
      </View>
      <ScrollView
        contentContainerStyle={styles.flowBody}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {footer ? <View style={styles.flowFooter}>{footer}</View> : null}
    </SafeAreaView>
  );
}

export function RadioRow({
  icon,
  tone = 'accent',
  title,
  body,
  selected,
  onPress,
  testID,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone?: Wash;
  title: string;
  body?: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={title}
      testID={testID}
      style={[
        styles.radioRow,
        { backgroundColor: colors.surface, borderColor: selected ? colors.accent : colors.border },
        selected && { borderWidth: 1.5 },
      ]}
    >
      <IconBadge icon={icon} tone={tone} size={38} />
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: colors.ink }]}>{title}</Text>
        {body ? <Text style={[type.caption, { color: colors.inkMuted }]}>{body}</Text> : null}
      </View>
      <View
        style={[
          styles.radio,
          { borderColor: selected ? colors.accent : colors.border },
          selected && { backgroundColor: colors.accent },
        ]}
      >
        {selected ? <Ionicons name="checkmark" size={13} color={colors.onAccent} /> : null}
      </View>
    </Pressable>
  );
}

export function InfoRow({
  icon,
  tone = 'accent',
  title,
  body,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone?: Wash;
  title: string;
  body?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.infoRow, { backgroundColor: colors.surface }]}>
      <IconBadge icon={icon} tone={tone} size={38} />
      <View style={{ flex: 1 }}>
        <Text style={[type.label, { color: colors.ink }]}>{title}</Text>
        {body ? <Text style={[type.caption, { color: colors.inkMuted }]}>{body}</Text> : null}
      </View>
    </View>
  );
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'] as const;

/** Mockup PIN pad: 4 dots + numeric grid. Calls onComplete when 4 digits are in. */
export function PinPad({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  error?: string | null;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();

  const press = (k: (typeof KEYS)[number]) => {
    if (k === '') return;
    if (k === 'back') onChange(value.slice(0, -1));
    else if (value.length < 4) onChange(value + k);
  };

  return (
    <View style={styles.pinWrap}>
      <View style={styles.dots} accessible accessibilityLabel={t('options.pin.digitsA11y', { count: value.length })}>
        {[0, 1, 2, 3].map((i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { borderColor: error ? colors.danger : colors.accent },
              i < value.length && { backgroundColor: error ? colors.danger : colors.accent },
            ]}
          />
        ))}
      </View>
      {error ? (
        <Text style={[type.caption, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
      ) : null}
      <View style={styles.grid}>
        {KEYS.map((k, i) => (
          <Pressable
            key={i}
            onPress={() => press(k)}
            disabled={k === ''}
            accessibilityRole="button"
            accessibilityLabel={k === 'back' ? t('options.pin.deleteA11y') : k}
            testID={k === 'back' ? 'pin-back' : k ? `pin-${k}` : undefined}
            style={[styles.key, k !== '' && { backgroundColor: colors.surface }]}
          >
            {k === 'back' ? (
              <Ionicons name="backspace-outline" size={22} color={colors.ink} />
            ) : (
              <Text style={[styles.keyText, { color: colors.ink }]}>{k}</Text>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

/** Celebration/confirm modal over a scrim ("Panda Mask is on!!", "Panda Pause is on."). */
export function ConfirmModal({
  visible,
  art,
  title,
  body,
  rows,
  cta,
  onDone,
}: {
  visible: boolean;
  art?: ReactNode;
  title: string;
  body?: string;
  rows?: { icon: keyof typeof Ionicons.glyphMap; tone?: Wash; title: string; body?: string }[];
  cta: string;
  onDone: () => void;
}) {
  const { colors, elevation } = useTheme();
  if (!visible) return null;
  return (
    <View style={[styles.modalBackdrop, { backgroundColor: colors.scrim }]}>
      <View style={[styles.modalCard, { backgroundColor: colors.surface }, elevation.md]} testID="opt-confirm-modal">
        {art ? <View style={styles.modalArt}>{art}</View> : null}
        <Text style={[styles.modalTitle, { color: colors.ink }]}>{title}</Text>
        {body ? (
          <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>{body}</Text>
        ) : null}
        {rows?.map((r) => (
          <View key={r.title} style={[styles.infoRow, { backgroundColor: colors.surfaceAlt }]}>
            <IconBadge icon={r.icon} tone={r.tone} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={[type.label, { color: colors.ink }]}>{r.title}</Text>
              {r.body ? <Text style={[type.caption, { color: colors.inkMuted }]}>{r.body}</Text> : null}
            </View>
          </View>
        ))}
        <Pressable
          onPress={onDone}
          accessibilityRole="button"
          testID="opt-modal-done"
          style={[styles.modalBtn, { backgroundColor: colors.accent }]}
        >
          <Text style={[type.label, { color: colors.onAccent }]}>{cta}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function LockFootnote({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.lockRow}>
      <Ionicons name="lock-closed-outline" size={13} color={colors.inkMuted} />
      <Text style={[type.caption, { color: colors.inkMuted, flexShrink: 1 }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flow: { ...StyleSheet.absoluteFillObject, zIndex: 110 },
  flowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  flowTitle: { fontFamily: font.sansBold, fontSize: 18, lineHeight: 24 },
  flowBody: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm },
  flowFooter: { paddingHorizontal: space.lg, paddingBottom: space.md, paddingTop: space.sm, gap: space.sm },
  radioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.sm,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.sm,
  },
  pinWrap: { alignItems: 'center', gap: space.md },
  dots: { flexDirection: 'row', gap: space.md, marginVertical: space.sm },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space.sm,
    maxWidth: 3 * 76 + 2 * space.sm,
  },
  key: {
    width: 76,
    height: 60,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyText: { fontFamily: font.sansBold, fontSize: 22 },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 130,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  modalCard: {
    alignSelf: 'stretch',
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
    alignItems: 'center',
  },
  modalArt: { marginBottom: space.xs },
  modalTitle: { fontFamily: font.serifBold, fontSize: 24, lineHeight: 30, textAlign: 'center' },
  modalBtn: {
    alignSelf: 'stretch',
    height: 50,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.sm,
  },
  lockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.md,
  },
});

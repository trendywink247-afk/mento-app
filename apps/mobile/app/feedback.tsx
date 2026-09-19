/**
 * Feedback sheet (board A11) — a screens-backed `transparentModal` route at `/feedback`, so
 * every quiet "Feedback" pill (tab headers, Not found) and Reflection's "Tell us how this
 * felt" open the same sheet. `?from=` carries the opener's ROUTE TEMPLATE (never a real id).
 *
 * Board: "Tell us what happened", three category chips, a bounded "What were you trying to
 * do?" box, the one line about what is attached ("We also note the screen name and app
 * version. Nothing else."), "Not now" / "Send". Wired to `POST /feedback`
 * (docs/superpowers/specs/2026-09-19-board-port-api.md §B3). The board's screenshot
 * thumbnail is NOT built: the API has no file storage, and a screenshot of a chat would
 * attach exactly what the sheet promises never to attach (spec §B3).
 *
 * Crisis words come back as `status: "support"` with helplines: the sheet shows the still
 * crisis card instead of a thank-you (T&S #1, #11).
 *
 * Motion: the scrim fades to 0.35 and the sheet rises on one shared value
 * (useSheetDepth); rows arrive in reading order. Reduced motion: a plain fade.
 */
import Constants from 'expo-constants';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import { CrisisCard } from '@/components/chat/CrisisCard';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { useSheetDepth } from '@/components/motion/useSheetDepth';
import { ApiError, api, type FeedbackCategory, type FeedbackCrisis } from '@/lib/api';
import { useI18n, type TKey } from '@/lib/i18n';
import { useFrameSize } from '@/lib/useFrameSize';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

const CATEGORIES: { key: FeedbackCategory; label: TKey }[] = [
  { key: 'broken', label: 'feedback.broken' },
  { key: 'confusing', label: 'feedback.confusing' },
  { key: 'idea', label: 'feedback.idea' },
];
const MAX = 1000;
const SCREEN_RE = /^[A-Za-z0-9_\-/[\]().+]{1,64}$/;

export default function FeedbackSheet() {
  const router = useRouter();
  const { colors, elevation } = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const { height: frame } = useFrameSize();
  const { from } = useLocalSearchParams<{ from?: string }>();

  const [open, setOpen] = useState(true);
  const depth = useSheetDepth(open);
  const [category, setCategory] = useState<FeedbackCategory>('broken');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [crisis, setCrisis] = useState<FeedbackCrisis | null>(null);

  // The closing run has finished: now the route itself goes.
  useEffect(() => {
    if (!open && !depth.shown) router.back();
  }, [open, depth.shown, router]);

  const close = () => setOpen(false);

  const sheetHeight = useSharedValue(frame);
  const scrim = useAnimatedStyle(() => ({ opacity: depth.progress.value }));
  const rise = useAnimatedStyle(() =>
    depth.reduced
      ? { opacity: depth.progress.value, transform: [{ translateY: 0 }] }
      : { opacity: 1, transform: [{ translateY: (1 - depth.progress.value) * sheetHeight.value }] },
  );

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.sendFeedback({
        category,
        text: body,
        ...(from && SCREEN_RE.test(from) ? { screen: from } : {}),
        ...(Constants.expoConfig?.version ? { app_version: Constants.expoConfig.version.slice(0, 32) } : {}),
      });
      if (res.status === 'support' && res.crisis) setCrisis(res.crisis);
      else setSent(true);
    } catch (e) {
      // One still line; the words stay in the box (T&S #11).
      setError(e instanceof ApiError ? e.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrimSheet }, scrim]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityLabel={t('feedback.closeA11y')}
          testID="feedback-backdrop"
        />
      </Animated.View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav} pointerEvents="box-none">
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
          accessibilityViewIsModal
          accessibilityLabel={t('feedback.a11y')}
          testID="feedback-sheet"
        >
          <View style={[styles.handle, { backgroundColor: colors.edgeAlt }]} />
          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.body}
          >
            {crisis ? (
              <>
                <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
                  {t('feedback.crisisTitle')}
                </Text>
                <CrisisCard crisis={crisis} audience="feedback" inset={false} />
                <PrimaryButton label={t('feedback.close')} shape="key" variant="surface" onPress={close} testID="feedback-close" />
              </>
            ) : sent ? (
              <View testID="feedback-sent" style={styles.sent}>
                <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
                  {t('feedback.sentTitle')}
                </Text>
                <Text style={[styles.sub, { color: colors.inkMuted }]}>{t('feedback.sentBody')}</Text>
                <PrimaryButton label={t('feedback.close')} shape="key" onPress={close} testID="feedback-close" />
              </View>
            ) : (
              <>
                <Entrance index={2} style={styles.head}>
                  <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
                    {t('feedback.title')}
                    <Text style={{ color: colors.accent }}>{t('feedback.titleAccent')}</Text>
                  </Text>
                  <Text style={[styles.sub, { color: colors.inkMuted }]}>{t('feedback.sub')}</Text>
                </Entrance>

                <Entrance index={3} style={styles.chips}>
                  {CATEGORIES.map((c) => {
                    const on = c.key === category;
                    return (
                      <PressKey
                        key={c.key}
                        onPress={() => setCategory(c.key)}
                        edge={on ? 'transparent' : colors.edgeSurface}
                        travel={3}
                        radius={radius.pill}
                        intent="select"
                        accessibilityRole="radio"
                        accessibilityState={{ checked: on }}
                        testID={`feedback-cat-${c.key}`}
                        style={[
                          styles.chip,
                          on
                            ? { backgroundColor: colors.accentTint, borderColor: colors.accent, borderWidth: 2 }
                            : { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
                        ]}
                      >
                        <Text style={[styles.chipText, { color: on ? colors.accent : colors.ink }]}>{t(c.label)}</Text>
                      </PressKey>
                    );
                  })}
                </Entrance>

                <Entrance index={4} style={styles.field}>
                  <Text nativeID="feedback-note-label" style={[styles.label, { color: colors.inkMuted }]}>
                    {t('feedback.label')}
                  </Text>
                  <EdgeSurface
                    edge={colors.edgeSurface}
                    travel={4}
                    radius={radius.md}
                    style={[styles.inputFace, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  >
                  <TextInput
                    value={text}
                    onChangeText={setText}
                    maxLength={MAX}
                    multiline
                    placeholder={t('feedback.placeholder')}
                    placeholderTextColor={colors.inkMuted}
                    accessibilityLabel={t('feedback.label')}
                    aria-labelledby="feedback-note-label"
                    testID="feedback-text"
                    style={[styles.input, { color: colors.ink }]}
                  />
                  </EdgeSurface>
                </Entrance>

                <Entrance index={5}>
                  <Text style={[type.caption, { color: colors.inkMuted }]}>{t('feedback.attached')}</Text>
                  {error ? (
                    <Text style={[type.caption, styles.error, { color: colors.danger }]} testID="feedback-error">
                      {error}
                    </Text>
                  ) : null}
                </Entrance>

                <Entrance index={6} style={styles.actions}>
                  <View style={styles.notNow}>
                    <PrimaryButton
                      label={t('feedback.notNow')}
                      shape="key"
                      variant="surface"
                      dense
                      onPress={close}
                      testID="feedback-not-now"
                    />
                  </View>
                  <View style={styles.sendKey}>
                    <PrimaryButton
                      label={t('feedback.send')}
                      shape="key"
                      onPress={() => void send()}
                      disabled={!text.trim()}
                      loading={busy}
                      testID="feedback-send"
                    />
                  </View>
                </Entrance>
              </>
            )}
          </ScrollView>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  kav: { flex: 1, justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingTop: 12 },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: radius.pill },
  body: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.md },
  head: { gap: space.xs },
  title: { fontFamily: font.sansHeavy, fontSize: 24, lineHeight: 32 },
  sub: { fontFamily: font.sans, fontSize: 15, lineHeight: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { minHeight: 44, paddingHorizontal: space.md, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 20 },
  field: { gap: 6 },
  label: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  inputFace: { borderWidth: 1 },
  input: {
    minHeight: 110,
    maxHeight: 180,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: font.sans,
    fontSize: 16,
    lineHeight: 24,
    textAlignVertical: 'top',
  },
  error: { marginTop: space.xs },
  actions: { flexDirection: 'row', gap: 12 },
  notNow: { flex: 1 },
  sendKey: { flex: 1.4 },
  sent: { gap: space.md },
});

/**
 * After End: the private reflection (board A23, SCOPE §8).
 *
 * "Conversation ended" pill, the member's companion sitting and breathing on a small
 * ground, "How do you feel now?", the five-stop energy slider whose word follows it
 * (Drained · Low · Steady · Lighter · Clear) with the five word keys as the keyboard /
 * TalkBack path, "Only you see this…", an optional "One thing I am taking with me" that is
 * kept in the Journal, "Done" → My Chats (`leaveToChats`, never a second tab navigator),
 * and the quiet "Tell us how this felt" → the feedback sheet.
 *
 * No points, no thanks-for-rating, nothing about money (DECISIONS §A.3). Server contract
 * unchanged: `POST /conversations/{id}/reflection {energy}` — sent only when the member
 * actually moved the slider, so an untouched "Steady" is never recorded as an answer. The
 * sentence goes to the Journal as a plain mood-channel note, never linked to the energy.
 *
 * Arrival: the pill, back key and companion are already there; the words, the slider card,
 * the note, Done and the link rise in reading order. Reduced motion: no breath, no glide.
 */
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EdgeSurface } from '@/components/EdgeSurface';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Companion } from '@/components/art/Companion';
import { RadialWash } from '@/components/art/RadialWash';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { useHeroBreath } from '@/components/motion/useHeroBreath';
import { capture } from '@/lib/analytics';
import { api } from '@/lib/api';
import { useI18n, type TKey } from '@/lib/i18n';
import { leaveToChats } from '@/lib/leaveToChats';
import { useCompanionAnimal } from '@/lib/useCompanionAnimal';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { duration, easing } from '@/theme/motion';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS } from '@/theme/companion';
import { font, radius, space, type, wash } from '@/theme/tokens';

const WORDS: TKey[] = ['reflection.e1', 'reflection.e2', 'reflection.e3', 'reflection.e4', 'reflection.e5'];
const THUMB = 44;
const TRACK_MAX = 310;

export default function ReflectionScreen() {
  const router = useRouter();
  useSessionGuard();
  const { colors } = useTheme();
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const animal = useCompanionAnimal();
  const breath = useHeroBreath();
  const { conversation, listener } = useLocalSearchParams<{ conversation?: string; listener?: string }>();

  const [energy, setEnergy] = useState(3);
  const [touched, setTouched] = useState(false);
  const [take, setTake] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackW, setTrackW] = useState(TRACK_MAX);
  const step = (trackW - THUMB) / 4;

  const choose = (n: number) => {
    const v = Math.max(1, Math.min(5, Math.round(n)));
    setTouched(true);
    setEnergy(v);
  };

  // The thumb and the fill glide on one value; reduced motion jumps.
  const pos = useSharedValue(2);
  useEffect(() => {
    pos.value = reduced ? energy - 1 : withTiming(energy - 1, { duration: duration.base, easing: easing.settle });
  }, [energy, reduced, pos]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: pos.value * step }] }), [step]);
  const fill = useAnimatedStyle(
    () => ({ transform: [{ translateX: pos.value * step + THUMB / 2 - trackW }] }),
    [step, trackW],
  );

  const fromTouch = (e: GestureResponderEvent) => choose((e.nativeEvent.locationX - THUMB / 2) / step + 1);
  const onA11yAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment') choose(energy + 1);
    if (e.nativeEvent.actionName === 'decrement') choose(energy - 1);
  };

  const done = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const sentence = take.trim();
    if (sentence) {
      try {
        await api.createJournalEntry({ channel: 'mood', body: sentence, meta: { from: 'reflection' } });
      } catch {
        // The member's own words are not lost silently: one still line, they stay in the box.
        setError(t('common.somethingWrong'));
        setBusy(false);
        return;
      }
    }
    if (conversation && touched) {
      try {
        await api.saveReflection(conversation, energy);
        // That it happened, never the energy value — reflection is private.
        capture('reflection_submitted');
      } catch {
        // Private and optional — never block leaving on it.
      }
    }
    leaveToChats(router);
  };

  const word = t(WORDS[energy - 1]);
  const sageInk = COMPANION_COLORS.sage.accentEdge;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bgLavender }]} edges={['top', 'bottom']} testID="reflection">
      <RadialWash
        pools={[
          { left: -150, top: -190, width: 690, height: 560, color: colors.accentTint },
          { right: -280, top: 250, width: 520, height: 460, color: COMPANION_COLORS.sage.accent, opacity: 0.16 },
        ]}
      />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.top}>
            <PressKey
              onPress={() => leaveToChats(router)}
              edge={colors.edgeSurface}
              radius={radius.pill}
              accessibilityLabel={t('reflection.skipA11y')}
              testID="reflection-skip"
              style={[styles.round, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <Ionicons name="close" size={20} color={colors.ink} />
            </PressKey>
            <View style={[styles.pill, { backgroundColor: wash.green }]} testID="reflection-ended">
              <Ionicons name="leaf-outline" size={16} color={sageInk} />
              <Text style={[styles.pillText, { color: sageInk }]}>{t('reflection.ended')}</Text>
            </View>
          </View>

          <View style={styles.stage} accessible accessibilityLabel={t('reflection.companionA11y')}>
            <View style={[styles.ground, { backgroundColor: colors.borderStrong }]} />
            <Animated.View style={[styles.feet, breath]}>
              <Companion animal={animal ?? null} size={160} awake />
            </Animated.View>
          </View>

          <View style={styles.head}>
            <Entrance index={0}>
              <Text style={[styles.headline, { color: colors.ink }]} accessibilityRole="header">
                {t('reflection.headline')}
                <Text style={{ color: colors.accent }}>{t('reflection.headlineAccent')}</Text>
                {t('reflection.headlineEnd')}
              </Text>
            </Entrance>
            <Entrance index={1}>
              <Text style={[type.note, styles.center, { color: colors.inkMuted }]}>
                {listener ? t('reflection.sub', { name: listener }) : t('reflection.subNoName')}
              </Text>
            </Entrance>
          </View>

          <Entrance index={2} style={styles.cardWrap}>
            <EdgeSurface
              edge={colors.edgeSurface}
              travel={3}
              radius={radius.lg}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
            >
              <View style={styles.cardHead}>
                <Text style={[styles.overline, { color: colors.inkMuted }]}>{t('reflection.energy')}</Text>
                <Text
                  style={[styles.word, { color: colors.accent }]}
                  accessibilityLiveRegion="polite"
                  aria-live="polite"
                  testID="reflection-word"
                >
                  {word}
                </Text>
              </View>

              <View
                style={styles.slider}
                onLayout={(e) => setTrackW(Math.min(TRACK_MAX, e.nativeEvent.layout.width))}
              >
                <View
                  style={[styles.sliderBox, { width: trackW }]}
                  onStartShouldSetResponder={() => true}
                  onMoveShouldSetResponder={() => true}
                  onResponderTerminationRequest={() => false}
                  onResponderGrant={fromTouch}
                  onResponderMove={fromTouch}
                  accessible
                  accessibilityRole="adjustable"
                  accessibilityLabel={t('reflection.energy')}
                  accessibilityValue={{ min: 1, max: 5, now: energy, text: word }}
                  accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                  onAccessibilityAction={onA11yAction}
                  testID="energy-slider"
                >
                  <View
                    pointerEvents="none"
                    style={[styles.track, { backgroundColor: colors.bgLavender, borderColor: colors.borderStrong }]}
                  >
                    <Animated.View style={[styles.fill, { width: trackW, backgroundColor: colors.accentTint }, fill]}>
                      <View style={[styles.inset, { backgroundColor: colors.accentTintEdge }]} />
                    </Animated.View>
                    <View style={[styles.inset, { backgroundColor: colors.edgeSurface, opacity: 0.6 }]} />
                    <View style={styles.dots}>
                      {WORDS.map((w) => (
                        <View key={w} style={[styles.dot, { backgroundColor: colors.dashIdle }]} />
                      ))}
                    </View>
                  </View>
                  <Animated.View pointerEvents="none" style={[styles.thumbWrap, thumb]}>
                    <View style={[styles.thumbEdge, { backgroundColor: colors.accentEdge }]} />
                    <View style={[styles.thumb, { backgroundColor: colors.accent }]}>
                      <View style={[styles.thumbDot, { backgroundColor: colors.onAccent }]} />
                    </View>
                  </Animated.View>
                </View>
              </View>

              <View style={styles.words}>
                {WORDS.map((w, i) => {
                  const on = energy === i + 1;
                  return (
                    <PressKey
                      key={w}
                      onPress={() => choose(i + 1)}
                      edge="transparent"
                      travel={2}
                      radius={radius.sm}
                      intent="select"
                      haptic="none"
                      accessibilityRole="radio"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={t('reflection.energyA11y', { word: t(w) })}
                      testID={`energy-${i + 1}`}
                      containerStyle={styles.wordKeyWrap}
                      style={styles.wordKey}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          styles.wordText,
                          { color: on ? colors.ink : colors.inkMuted, fontFamily: on ? font.sansHeavy : font.sansSemi },
                        ]}
                      >
                        {t(w)}
                      </Text>
                    </PressKey>
                  );
                })}
              </View>
            </EdgeSurface>
          </Entrance>

          <Entrance index={3} style={styles.after}>
            <View style={styles.privateRow}>
              <Ionicons name="lock-closed-outline" size={16} color={colors.inkMuted} style={styles.lineIcon} />
              <Text style={[type.caption, styles.shrink, { color: colors.inkMuted }]} testID="reflection-private">
                {t('reflection.private')}
              </Text>
            </View>

            <View style={styles.field}>
              <View style={styles.fieldHead}>
                <Text nativeID="reflection-take-label" style={[styles.fieldLabel, { color: colors.ink }]}>
                  {t('reflection.take')}
                </Text>
                <Text style={[type.caption, { color: colors.inkMuted }]}>{t('reflection.optional')}</Text>
              </View>
              <EdgeSurface
                edge={colors.edgeSurface}
                travel={4}
                radius={radius.md}
                style={[styles.inputFace, { backgroundColor: colors.surface, borderColor: colors.border }]}
              >
                <TextInput
                  value={take}
                  onChangeText={setTake}
                  maxLength={280}
                  placeholder={t('reflection.takePlaceholder')}
                  placeholderTextColor={colors.inkMuted}
                  accessibilityLabel={t('reflection.take')}
                  aria-labelledby="reflection-take-label"
                  returnKeyType="done"
                  testID="reflection-take"
                  style={[styles.input, { color: colors.ink }]}
                />
              </EdgeSurface>
              <View style={styles.noteRow}>
                <Ionicons name="book-outline" size={16} color={colors.inkMuted} />
                <Text style={[type.caption, styles.shrink, { color: colors.inkMuted }]}>{t('reflection.takeNote')}</Text>
              </View>
              {error ? (
                <Text style={[type.caption, { color: colors.danger }]} testID="reflection-error">
                  {error}
                </Text>
              ) : null}
            </View>
          </Entrance>

          <View style={styles.grow} />

          <Entrance index={4}>
            <PrimaryButton
              label={t('reflection.done')}
              shape="key"
              onPress={() => void done()}
              loading={busy}
              testID="reflection-finish"
            />
          </Entrance>
          <Entrance index={5} style={styles.linkWrap}>
            <PressKey
              onPress={() => router.push({ pathname: '/feedback', params: { from: 'reflection' } })}
              edge="transparent"
              travel={2}
              radius={radius.sm}
              haptic="none"
              testID="reflection-feedback"
              style={styles.link}
            >
              <Text style={[styles.linkText, { color: colors.inkMuted }]}>{t('reflection.tellUs')}</Text>
            </PressKey>
          </Entrance>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, overflow: 'hidden' },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: 20 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  round: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  pill: {
    height: 32,
    paddingLeft: 10,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radius.pill,
  },
  pillText: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  stage: { height: 168, alignItems: 'center', justifyContent: 'flex-end' },
  ground: { position: 'absolute', bottom: 0, width: 124, height: 16, borderRadius: radius.pill },
  feet: { transformOrigin: 'bottom' },
  head: { gap: space.xs, paddingTop: 12 },
  headline: { fontFamily: font.sansHeavy, fontSize: 28, lineHeight: 36, textAlign: 'center' },
  center: { textAlign: 'center' },
  cardWrap: { paddingTop: 14 },
  card: { paddingTop: 12, paddingHorizontal: 15, paddingBottom: 4, gap: 4, borderWidth: 1 },
  cardHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  overline: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18, letterSpacing: 0.5, textTransform: 'uppercase' },
  word: { fontFamily: font.sansHeavy, fontSize: 24, lineHeight: 30 },
  slider: { alignSelf: 'stretch', alignItems: 'center' },
  sliderBox: { height: 52 },
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 14,
    height: 24,
    borderRadius: radius.pill,
    borderWidth: 1,
    overflow: 'hidden',
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  inset: { position: 'absolute', left: 0, right: 0, top: 0, height: 3 },
  dots: {
    ...StyleSheet.absoluteFillObject,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dot: { width: 6, height: 6, borderRadius: radius.pill },
  thumbWrap: { position: 'absolute', left: 0, top: 2, width: THUMB, height: THUMB + 4 },
  thumbEdge: { position: 'absolute', left: 0, top: 4, width: THUMB, height: THUMB, borderRadius: radius.pill },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  thumbDot: { width: 14, height: 14, borderRadius: radius.pill },
  words: { flexDirection: 'row', marginHorizontal: -11 },
  wordKeyWrap: { flex: 1, minWidth: 0 },
  wordKey: { height: 44, alignItems: 'center', justifyContent: 'center' },
  wordText: { fontSize: 13, lineHeight: 18 },
  after: { paddingTop: 10, gap: 12 },
  privateRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'flex-start', gap: 6 },
  lineIcon: { paddingTop: 1 },
  shrink: { flexShrink: 1 },
  field: { gap: 6 },
  fieldHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  fieldLabel: { flexShrink: 1, fontFamily: font.sansBold, fontSize: 14, lineHeight: 20 },
  inputFace: { borderWidth: 1 },
  input: { height: 50, paddingHorizontal: 16, fontFamily: font.sans, fontSize: 16, lineHeight: 24 },
  noteRow: { paddingTop: space.xs, flexDirection: 'row', alignItems: 'center', gap: 6 },
  grow: { flexGrow: 1, minHeight: space.sm },
  linkWrap: { paddingTop: space.sm, alignItems: 'center' },
  link: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  linkText: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 20, textDecorationLine: 'underline' },
});

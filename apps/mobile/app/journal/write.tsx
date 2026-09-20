import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EdgeSurface } from '@/components/EdgeSurface';
import { CompanionPerches, CompanionSlot, useCompanionPlacement } from '@/components/art/PerchedCompanion';
import { JournalPageHeader, eyebrowStyle } from '@/components/journal/JournalPageHeader';
import { LinedPaper } from '@/components/journal/LinedPaper';
import { DeepArrival } from '@/components/motion/DeepArrival';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { api } from '@/lib/api';
import type { PlacementSlot } from '@/lib/companionPlacement';
import { haptic } from '@/lib/haptics';
import { useI18n, type TKey } from '@/lib/i18n';
import { MOOD_SCALE, moodLabelKey, type MoodStep } from '@/lib/journalDays';
import { screenCache } from '@/lib/screenCache';
import { useSessionGuard } from '@/lib/useSessionGuard';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/**
 * Write (board A28) — today's page: the date, a gentle prompt that can be swapped for
 * another, a lined writing surface, the one-tap mood row, and "Save to today" pinned at
 * the foot. A line is enough; a mood alone is enough.
 *
 * Storage: one entry on the `mood` channel — the merged journal's free-writing channel
 * (same contract as the hub's one-tap mood: a mood with no words stores the mood as its
 * body). Nothing new server-side.
 */
const PROMPTS: TKey[] = ['journalPage.prompt1', 'journalPage.prompt2', 'journalPage.prompt3'];
const RULE = 32;
const PERCHES: PlacementSlot[] = [{ id: 'pageTop', type: 'top', level: 'mid', home: true }];

export default function JournalWriteScreen() {
  useSessionGuard();
  const router = useRouter();
  const { colors } = useTheme();
  const { t, locale } = useI18n();
  const [prompt, setPrompt] = useState(0);
  const [text, setText] = useState('');
  const [mood, setMood] = useState<MoodStep | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [room, setRoom] = useState(0);
  const [inked, setInked] = useState(0);
  // A failed save is a still state (T&S #11): the companion sits, nothing moves.
  const perch = useCompanionPlacement('journalWrite', PERCHES, { still: failed });

  const today = new Date().toLocaleDateString(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const words = text.trim();
  const canSave = (words.length > 0 || mood !== null) && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setFailed(false);
    try {
      const entry = await api.createJournalEntry({
        channel: 'mood',
        body: words.length > 0 ? words : (mood as string),
        meta: mood ? { mood } : {},
      });
      // The hub repaints from its cache first — put the new page in it so Today is never stale.
      const cached = screenCache.get('journal');
      if (cached) screenCache.set('journal', { ...cached, entries: [entry, ...cached.entries] });
      haptic.success();
      router.back();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <CompanionPerches placement={perch}>
          <View style={styles.page}>
            <JournalPageHeader
              onBack={() => router.back()}
              backLabel={t('journalPage.backA11y')}
              eyebrow={t('journals.today')}
              title={today}
            />

            <DeepArrival style={styles.column}>
              <Entrance index={1}>
                <Text style={[eyebrowStyle, styles.promptEyebrow, { color: colors.inkMuted }]}>
                  {t('journalPage.promptEyebrow')}
                </Text>
                <View style={styles.promptBox}>
                  {/* Keyed: a new prompt arrives the way the first one did. */}
                  <Entrance key={prompt} distance={8}>
                    <Text style={[styles.prompt, { color: colors.accent }]} testID="write-prompt">
                      {t(PROMPTS[prompt])}
                    </Text>
                  </Entrance>
                </View>
                <PressKey
                  onPress={() => setPrompt((p) => (p + 1) % PROMPTS.length)}
                  edge={colors.edgeSurface}
                  travel={3}
                  radius={radius.pill}
                  intent="select"
                  accessibilityLabel={t('journalPage.anotherPrompt')}
                  testID="write-another-prompt"
                  containerStyle={styles.anotherBox}
                  style={[styles.another, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <Ionicons name="refresh-outline" size={18} color={colors.ink} />
                  <Text style={[type.label, { color: colors.ink }]}>{t('journalPage.anotherPrompt')}</Text>
                </PressKey>
              </Entrance>

              <Entrance index={2} style={styles.fill}>
                <View style={styles.fill}>
                  <CompanionSlot id="pageTop" size={62} inset={22} />
                  <EdgeSurface
                    edge={colors.edgeSurface}
                    travel={3}
                    radius={radius.lg}
                    containerStyle={styles.fill}
                    style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]}
                  >
                    <View pointerEvents="none" style={[styles.margin, { backgroundColor: colors.accentTintEdge }]} />
                    <Text style={[styles.entryLabel, { color: colors.inkMuted }]} nativeID="write-entry-label">
                      {t('journalPage.entryLabel')}
                    </Text>
                    <ScrollView
                      style={styles.fill}
                      showsVerticalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      onLayout={(e) => setRoom(e.nativeEvent.layout.height)}
                    >
                      <LinedPaper rule={RULE} style={{ minHeight: Math.max(room, inked) }}>
                        <TextInput
                          value={text}
                          onChangeText={(v) => {
                            setText(v);
                            if (failed) setFailed(false);
                          }}
                          onContentSizeChange={(e) => setInked(Math.ceil(e.nativeEvent.contentSize.height / RULE) * RULE)}
                          multiline
                          scrollEnabled={false}
                          maxLength={4000}
                          placeholder={t('journalPage.entryPlaceholder')}
                          placeholderTextColor={colors.inkMuted}
                          accessibilityLabel={t('journalPage.entryLabel')}
                          accessibilityLabelledBy="write-entry-label"
                          textAlignVertical="top"
                          testID="write-entry"
                          style={[styles.input, { color: colors.ink, height: Math.max(room, inked) }]}
                        />
                      </LinedPaper>
                    </ScrollView>
                  </EdgeSurface>
                </View>
              </Entrance>

              <Entrance index={3} style={styles.moodBlock}>
                <Text style={[type.label, styles.moodTitle, { color: colors.ink }]}>
                  {t('journalPage.moodTitle')}{' '}
                  <Text style={{ fontFamily: font.sans, color: colors.inkMuted }}>{t('journalPage.moodHint')}</Text>
                </Text>
                <View style={styles.moodRow} accessibilityLabel={t('journalPage.moodTitle')}>
                  {MOOD_SCALE.map((m) => {
                    const on = mood === m;
                    const label = moodLabelKey(m);
                    return (
                      <PressKey
                        key={m}
                        onPress={() => setMood(on ? null : m)}
                        edge={on ? colors.accentTintEdge : colors.edgeAlt}
                        travel={3}
                        radius={radius.md}
                        intent="select"
                        accessibilityState={{ selected: on }}
                        accessibilityLabel={label ? t(label) : m}
                        testID={`write-mood-${m.toLowerCase()}`}
                        containerStyle={styles.moodCell}
                        style={[
                          styles.moodKey,
                          on
                            ? { backgroundColor: colors.accentTint, borderColor: colors.accent }
                            : { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
                        ]}
                      >
                        <Text
                          style={[styles.moodText, { color: on ? colors.accentEdge : colors.ink }]}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                        >
                          {label ? t(label) : m}
                        </Text>
                      </PressKey>
                    );
                  })}
                </View>
              </Entrance>

              <Entrance index={4} style={styles.foot}>
                {failed ? (
                  // Still on purpose: no arrival, no haptic.
                  <Text style={[type.caption, styles.center, { color: colors.ink }]} testID="write-error">
                    {t('journalPage.saveError')}
                  </Text>
                ) : null}
                <PressKey
                  onPress={() => void save()}
                  edge={colors.accentEdge}
                  radius={radius.md}
                  intent="commit"
                  disabled={!canSave}
                  accessibilityLabel={t('journalPage.save')}
                  testID="write-save"
                  style={[styles.save, { backgroundColor: colors.accent }]}
                >
                  <Ionicons name="checkmark" size={20} color={colors.onAccent} />
                  <Text style={[type.key, { color: colors.onAccent }]}>{t('journalPage.save')}</Text>
                </PressKey>
                <View style={styles.private}>
                  <Ionicons name="lock-closed-outline" size={15} color={colors.inkMuted} />
                  <Text style={[type.caption, { color: colors.inkMuted }]}>{t('journalPage.private')}</Text>
                </View>
              </Entrance>
            </DeepArrival>
          </View>
        </CompanionPerches>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  fill: { flex: 1, minHeight: 0 },
  page: { flex: 1, paddingTop: space.xs, paddingHorizontal: space.lg, paddingBottom: space.lg, gap: 14 },
  column: { flex: 1, minHeight: 0, gap: 12 },
  promptEyebrow: { paddingBottom: 4 },
  promptBox: { minHeight: 56, paddingRight: space.lg, paddingBottom: space.sm },
  prompt: { fontFamily: font.sansBold, fontSize: 20, lineHeight: 28 },
  anotherBox: { alignSelf: 'flex-start' },
  another: {
    height: 44,
    paddingLeft: 12,
    paddingRight: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
  },
  sheet: { flex: 1, minHeight: 0, paddingTop: 14, paddingHorizontal: space.md, paddingBottom: 12, gap: 6, borderWidth: 1, overflow: 'hidden' },
  margin: { position: 'absolute', left: 34, top: 0, bottom: 0, width: 1 },
  entryLabel: { paddingLeft: 30, fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  input: {
    paddingLeft: 30,
    paddingTop: 0,
    paddingBottom: 0,
    paddingRight: 0,
    fontFamily: font.sans,
    fontSize: 17,
    lineHeight: RULE,
    // reason: react-native-web draws a focus ring on a textarea; the page IS the field here.
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
  moodBlock: { gap: space.sm },
  moodTitle: { paddingHorizontal: space.xs },
  moodRow: { flexDirection: 'row', gap: 6 },
  moodCell: { flex: 1 },
  moodKey: { height: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2, borderWidth: 1 },
  moodText: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  foot: { gap: 12, paddingTop: 2 },
  save: { height: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  private: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  center: { textAlign: 'center' },
});

import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EdgeSurface } from '@/components/EdgeSurface';
import { Companion } from '@/components/art/Companion';
import { MentorPageHeader } from '@/components/mentor/MentorPageHeader';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import { SageSky } from '@/components/motion/SageSky';
import { useBreathing } from '@/components/motion/useBreathing';
import { useI18n, type TKey } from '@/lib/i18n';
import { leaveToMentorHome } from '@/lib/leaveToChats';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/**
 * Reading 1 — "Before your first chat" (board A12, reached from Mentor Home's Reading row
 * and from the Approved card). A calm paged reader: the board's header (round pillow back
 * key, sage eyebrow, page name), a row of page dots, one idea per page, Back / Next, and
 * the mentor's owl reading along above the keys.
 *
 * Eight pages of the reading, then the commitment page (a still card — nothing is ticked,
 * scored or recorded; the words are what the mentor is agreeing to, not a form), then one
 * honest page saying the next readings are still being written.
 *
 * Content rules (the drafts were written to them, and they stay): no personal anecdotes,
 * no third-party names, no money, mentor vocabulary (mentor / member), and the crisis page
 * carries Mento's own T&S line — the helplines are Tele-MANAS 14416 and KIRAN
 * 1800-599-0019, the mentor points to them and is never the counsellor.
 *
 * Motion: each page arrives through `Entrance` (transform + opacity, reduced-motion aware)
 * by re-mounting on the page key; the owl breathes and goes still under reduced motion.
 */
type Page = { eyebrow: TKey | null; title: TKey; accent: TKey; body: TKey; card?: boolean };

const READING: Page[] = [
  { eyebrow: null, title: 'mentorReading.p1Title', accent: 'mentorReading.p1Accent', body: 'mentorReading.p1Body' },
  { eyebrow: null, title: 'mentorReading.p2Title', accent: 'mentorReading.p2Accent', body: 'mentorReading.p2Body' },
  { eyebrow: null, title: 'mentorReading.p3Title', accent: 'mentorReading.p3Accent', body: 'mentorReading.p3Body' },
  { eyebrow: null, title: 'mentorReading.p4Title', accent: 'mentorReading.p4Accent', body: 'mentorReading.p4Body' },
  { eyebrow: null, title: 'mentorReading.p5Title', accent: 'mentorReading.p5Accent', body: 'mentorReading.p5Body' },
  { eyebrow: null, title: 'mentorReading.p6Title', accent: 'mentorReading.p6Accent', body: 'mentorReading.p6Body' },
  { eyebrow: null, title: 'mentorReading.p7Title', accent: 'mentorReading.p7Accent', body: 'mentorReading.p7Body' },
  { eyebrow: null, title: 'mentorReading.p8Title', accent: 'mentorReading.p8Accent', body: 'mentorReading.p8Body' },
  {
    eyebrow: 'mentorReading.commitmentEyebrow',
    title: 'mentorReading.p9Title',
    accent: 'mentorReading.p9Accent',
    body: 'mentorReading.p9Body',
    card: true,
  },
  {
    eyebrow: 'mentorReading.lastEyebrow',
    title: 'mentorReading.lastTitle',
    accent: 'mentorReading.lastAccent',
    body: 'mentorReading.lastBody',
  },
];
/** The eight reading pages; the commitment and the closing note are not numbered. */
const READING_PAGES = 8;
const COMMITMENT = 8;
const LAST = READING.length - 1;

export default function MentorReading() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const breathing = useBreathing();
  const [page, setPage] = useState(0);
  const current = READING[page];

  const back = () => (page === 0 ? leaveToMentorHome(router) : setPage((n) => n - 1));
  const forward = () => (page === LAST ? leaveToMentorHome(router) : setPage((n) => n + 1));
  const forwardLabel =
    page === COMMITMENT ? t('mentorReading.acknowledge') : page === LAST ? t('mentorReading.toHome') : t('mentorReading.next');
  const backLabel = page === LAST ? t('mentorReading.readAgain') : t('mentorReading.back');

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={['top', 'bottom']}>
      <SageSky shape="top" />
      <View style={styles.frame} testID="mentor-reading">
        <MentorPageHeader
          eyebrow={t('mentorReading.eyebrow')}
          title={t('mentorReading.title')}
          onBack={() => leaveToMentorHome(router)}
        />

        {/* Page dots: one segment per page, the ones behind you filled. Never a score. */}
        <View
          style={styles.dots}
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t('mentorReading.progressA11y', { page: page + 1, total: READING.length })}
        >
          {READING.map((p, i) => (
            <View
              key={p.title}
              style={[styles.dot, { backgroundColor: i <= page ? colors.accent : colors.handle }]}
            />
          ))}
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          testID={`reading-page-${page + 1}`}
        >
          {/* reason: re-mounting on the page number is what gives every page the same
              arrival (Entrance animates on mount and consults reduced motion itself). */}
          <Entrance key={page} index={0} style={styles.page}>
            <Text style={[type.caption, styles.eyebrow, { color: colors.inkMuted }]}>
              {current.eyebrow
                ? t(current.eyebrow)
                : t('mentorReading.pageOf', { page: page + 1, total: READING_PAGES })}
            </Text>
            <Text style={[styles.h1, { color: colors.ink }]} accessibilityRole="header">
              {t(current.title)}
              <Text style={{ color: colors.accent }}>{t(current.accent)}</Text>
            </Text>
            {current.card ? (
              <>
                <EdgeSurface
                  edge={colors.edgeSurface}
                  radius={radius.lg}
                  style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <Text style={[styles.body, { color: colors.ink }]}>{t(current.body)}</Text>
                </EdgeSurface>
                <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentorReading.commitmentNote')}</Text>
              </>
            ) : (
              <Text style={[styles.body, { color: colors.ink }]}>{t(current.body)}</Text>
            )}
          </Entrance>
        </ScrollView>

        <View style={styles.foot}>
          <View
            style={styles.perch}
            pointerEvents="none"
            accessible
            accessibilityRole="image"
            accessibilityLabel={t('mentorReading.companionA11y')}
          >
            <Animated.View style={[styles.originBottom, breathing]}>
              <Companion animal="Owl" size={84} awake />
            </Animated.View>
          </View>
          <View style={styles.keys}>
            <PressKey
              onPress={back}
              edge={colors.edgeSurface}
              radius={radius.md}
              intent="navigate"
              testID="reading-back"
              containerStyle={page === LAST ? styles.keyBackShort : styles.keyBack}
              style={[styles.key, { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 }]}
            >
              <Text style={[styles.keyText, { color: colors.ink }]} numberOfLines={1}>
                {backLabel}
              </Text>
            </PressKey>
            <PressKey
              onPress={forward}
              edge={colors.accentEdge}
              radius={radius.md}
              intent="navigate"
              testID="reading-next"
              containerStyle={page === LAST ? styles.keyNextWide : styles.keyNext}
              style={[styles.key, { backgroundColor: colors.accent }]}
            >
              <Text
                style={[styles.keyText, page === LAST ? null : styles.keyTextLead, { color: colors.onAccent }]}
                numberOfLines={1}
              >
                {forwardLabel}
              </Text>
              {page < COMMITMENT ? <Ionicons name="arrow-forward" size={20} color={colors.onAccent} /> : null}
            </PressKey>
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  frame: { flex: 1, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.md, gap: 14 },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { flex: 1, height: 6, borderRadius: radius.pill },
  content: { paddingTop: space.xs, paddingBottom: space.md },
  page: { gap: 14 },
  eyebrow: { fontFamily: type.label.fontFamily, letterSpacing: 0.5, textTransform: 'uppercase' },
  h1: { fontSize: 28, lineHeight: 36, fontFamily: type.displayHeadline.fontFamily },
  body: { fontSize: 17, lineHeight: 28, fontFamily: type.body.fontFamily },
  card: { padding: 18, borderWidth: 1 },
  foot: { gap: 12 },
  // The owl stands on the keys' top edge, as the board draws it.
  perch: { position: 'absolute', right: 6, bottom: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  originBottom: { transformOrigin: 'bottom' },
  keys: { flexDirection: 'row', gap: 12 },
  keyBack: { flex: 1, minWidth: 0 },
  keyNext: { flex: 1.4, minWidth: 0 },
  // The last page swaps the weights: "Read again" is short and "Back to Mentor Home" is the
  // longest label in the reader — in the usual 1 : 1.4 pair it clipped at 390.
  keyBackShort: { flex: 0.8, minWidth: 0 },
  keyNextWide: { flex: 2, minWidth: 0 },
  key: { height: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12 },
  keyText: { fontSize: 16, lineHeight: 24, fontFamily: type.label.fontFamily, flexShrink: 1, minWidth: 0 },
  keyTextLead: { fontSize: 18 },
});

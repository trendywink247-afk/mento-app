/**
 * DayBook — one past day opened as a small book (board A29): an accent cover with a
 * pillow edge and a stitched spine, a ribbon hanging below it, and white pages that show
 * a sliver of the pages underneath. Inside: the date, how the day felt (five dots),
 * "Guidance you kept" with the mentor's name THAT day and a link back to the chat, then
 * what the member wrote, on ruled lines. A quiet day is a blank page, and that is fine.
 *
 * Presentational and still: nothing here animates (the screen arrives it as one block).
 */
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { MentorFace, type MentorLook } from '@/components/art/MentorFace';
import { eyebrowStyle } from '@/components/journal/JournalPageHeader';
import { LinedPaper } from '@/components/journal/LinedPaper';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import { moodLabelKey, moodLevel, type DayPage } from '@/lib/journalDays';
import { COMPANION_COLORS } from '@/theme/companion';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, washInk } from '@/theme/tokens';

const RULE = 28;
/** The mood dots keep one fixed hue (plum) — a feeling is not the member's accent. */
const MOOD_INK = COMPANION_COLORS.plum.accentEdge;
const MOOD_IDLE = COMPANION_COLORS.plum.accentTintEdge;

export type KeptGroup = {
  key: string;
  /** The chat this came from, when it can still be opened; null = no link. */
  conversationId: string | null;
  name: string;
  /** The mentor's face (server mentor_face), when this build can know it; null = a plain mark. */
  face: MentorLook | null;
  lines: { id: string; body: string }[];
};

export function DayBook({
  ago,
  weekday,
  date,
  page,
  kept,
  onOpenChat,
}: {
  ago: string;
  weekday: string;
  date: string;
  page: DayPage;
  kept: KeptGroup[];
  onOpenChat: (conversationId: string) => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const level = moodLevel(page.mood);
  const moodKey = moodLabelKey(page.mood);
  const moodWord = moodKey ? t(moodKey) : page.mood;
  const quiet = kept.length === 0 && page.wrote.length === 0 && page.grateful.length === 0 && !page.mood;
  const wroteTitle = kept.length > 0 ? t('journals.youWrote') : t('journalPage.youWrote');

  return (
    <View testID="day-book">
      {/* The ribbon hangs from under the cover. */}
      <View style={styles.ribbon} pointerEvents="none">
        <Svg width={14} height={30} viewBox="0 0 14 30">
          <Path d="M0 0H14V30L7 21.6L0 30Z" fill={colors.accentEdge} />
        </Svg>
      </View>
      <View style={styles.coverBox}>
        <View pointerEvents="none" style={[styles.coverEdge, { backgroundColor: colors.accentEdge }]} />
        <View style={[styles.cover, { backgroundColor: colors.accent }]}>
          <View pointerEvents="none" style={[styles.stitch, { borderColor: colors.onAccent }]} />
          {/* Pages underneath: two slivers below the top page. */}
          <View style={styles.pagesBox}>
            <View pointerEvents="none" style={[styles.pageUnder, styles.pageUnder2, { backgroundColor: colors.border }]} />
            <View pointerEvents="none" style={[styles.pageUnder, styles.pageUnder1, { backgroundColor: colors.surfaceAlt }]} />
            <View pointerEvents="none" style={[styles.pageUnder, styles.pageUnder0, { backgroundColor: colors.border }]} />
            <View
              style={[styles.pageTop, quiet ? styles.pageQuiet : null, { backgroundColor: colors.surface }]}
              accessibilityLabel={`${weekday}, ${date}`}
            >
              <View>
                <Text style={[styles.ago, { color: colors.inkMuted }]}>{ago}</Text>
                <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header" testID="day-title">
                  {weekday}, <Text style={{ color: colors.accent }}>{date}</Text>
                </Text>
              </View>

              {page.mood ? (
                <View style={styles.moodRow} testID="day-mood">
                  <Text style={[eyebrowStyle, { color: colors.inkMuted }]}>{t('journalPage.dayFelt')}</Text>
                  {level > 0 ? (
                    <View
                      style={styles.dots}
                      accessibilityRole="image"
                      accessibilityLabel={t('journalPage.moodA11y', { mood: moodWord ?? '', level })}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <View key={n} style={[styles.dot, { backgroundColor: n <= level ? MOOD_INK : MOOD_IDLE }]} />
                      ))}
                    </View>
                  ) : null}
                  <Text style={[styles.moodWord, { color: MOOD_INK }]}>{moodWord}</Text>
                </View>
              ) : null}

              <View style={[styles.rule, { borderColor: colors.edgeAlt }]} />

              {quiet ? (
                <LinedPaper rule={RULE} style={styles.quietLines}>
                  <Text style={[styles.written, { color: colors.inkMuted }]} testID="day-quiet">
                    {t('journalPage.quietDay')}
                  </Text>
                  <Text style={[styles.written, { color: colors.inkMuted }]}>{t('journalPage.quietDay2')}</Text>
                </LinedPaper>
              ) : null}

              {kept.length > 0 ? (
                <View style={styles.section} testID="day-kept">
                  <Text style={[eyebrowStyle, { color: colors.accent }]}>{t('journals.kept')}</Text>
                  {kept.map((g) => (
                    <View key={g.key} style={styles.keptBox}>
                      <View pointerEvents="none" style={[styles.keptEdge, { backgroundColor: colors.accentTintEdge }]} />
                      <View style={[styles.keptFace, { backgroundColor: colors.accentTint }]}>
                        <View style={styles.keptWho}>
                          {g.face ? (
                            <MentorFace animal={g.face.animal} colour={g.face.colour} size={36} />
                          ) : (
                            <View style={[styles.keptMark, { backgroundColor: colors.surface }]}>
                              <Ionicons name="bookmark-outline" size={18} color={colors.accent} />
                            </View>
                          )}
                          <View style={styles.flexText}>
                            <Text style={[styles.keptName, { color: colors.ink }]} numberOfLines={1}>
                              {g.name}
                            </Text>
                            <Text style={[styles.keptSub, { color: colors.ink }]}>{t('journalPage.mentorThatDay')}</Text>
                          </View>
                        </View>
                        {g.lines.map((l) => (
                          <Text key={l.id} style={[styles.quote, { color: colors.ink, borderLeftColor: colors.accent }]}>
                            {l.body}
                          </Text>
                        ))}
                        {g.conversationId ? (
                          <PressKey
                            onPress={() => onOpenChat(g.conversationId as string)}
                            edge="transparent"
                            travel={2}
                            radius={radius.sm}
                            accessibilityRole="link"
                            accessibilityLabel={t('journals.keptFrom', { name: g.name })}
                            testID="day-open-chat"
                            containerStyle={styles.fromBox}
                            style={styles.from}
                          >
                            <Text style={[styles.fromText, { color: colors.accentEdge }]}>
                              {t('journals.keptFrom', { name: g.name })}
                            </Text>
                            <Ionicons name="chevron-forward" size={16} color={colors.accentEdge} />
                          </PressKey>
                        ) : (
                          <View style={styles.fromGap} />
                        )}
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              {page.wrote.length > 0 ? (
                <View style={styles.sectionTight} testID="day-wrote">
                  <Text style={[eyebrowStyle, { color: colors.inkMuted }]}>{wroteTitle}</Text>
                  <LinedPaper rule={RULE}>
                    {page.wrote.map((e) => (
                      <Text key={e.id} style={[styles.written, { color: colors.ink }]}>
                        {e.body}
                      </Text>
                    ))}
                  </LinedPaper>
                </View>
              ) : null}

              {page.grateful.length > 0 ? (
                <View style={styles.sectionTight} testID="day-grateful">
                  <Text style={[eyebrowStyle, { color: washInk.orange }]}>{t('journalPage.grateful')}</Text>
                  <LinedPaper rule={RULE}>
                    {page.grateful.map((e) => (
                      <Text key={e.id} style={[styles.written, { color: colors.ink }]}>
                        {e.body}
                      </Text>
                    ))}
                  </LinedPaper>
                </View>
              ) : null}

              {!quiet && kept.length === 0 ? (
                <Text style={[styles.noKept, { color: colors.inkMuted }]}>{t('journalPage.noKept')}</Text>
              ) : null}
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ribbon: { position: 'absolute', left: 52, bottom: -12, zIndex: 0 },
  coverBox: { paddingBottom: 4, zIndex: 1 },
  coverEdge: { ...StyleSheet.absoluteFillObject, top: 4, borderRadius: radius.lg },
  cover: { paddingTop: 6, paddingRight: 6, paddingBottom: 10, paddingLeft: 14, borderRadius: radius.lg },
  stitch: {
    position: 'absolute',
    left: 6,
    top: 22,
    bottom: 26,
    width: 0,
    borderLeftWidth: 2,
    borderStyle: 'dashed',
    opacity: 0.6,
  },
  pagesBox: { paddingBottom: 5 },
  pageUnder: {
    ...StyleSheet.absoluteFillObject,
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
    borderTopRightRadius: 17,
    borderBottomRightRadius: 17,
  },
  pageUnder0: { top: 2, bottom: 3 },
  pageUnder1: { top: 4, bottom: 1 },
  pageUnder2: { top: 5, bottom: 0 },
  pageTop: {
    paddingTop: 18,
    paddingRight: 16,
    paddingBottom: 18,
    paddingLeft: 18,
    gap: 12,
    borderTopLeftRadius: 10,
    borderBottomLeftRadius: 10,
    borderTopRightRadius: 17,
    borderBottomRightRadius: 17,
  },
  pageQuiet: { minHeight: 300 },
  ago: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  title: { fontFamily: font.sansHeavy, fontSize: 24, lineHeight: 32 },
  moodRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  dot: { width: 8, height: 8, borderRadius: radius.pill },
  moodWord: { fontFamily: font.sansBold, fontSize: 14, lineHeight: 20 },
  rule: { height: 0, borderTopWidth: 1, borderStyle: 'dashed' },
  quietLines: { flexGrow: 1, minHeight: 168 },
  section: { gap: 8 },
  sectionTight: { gap: 4 },
  keptBox: { paddingBottom: 3 },
  keptEdge: { ...StyleSheet.absoluteFillObject, top: 3, borderRadius: radius.md },
  keptFace: { paddingTop: 12, paddingHorizontal: 12, paddingBottom: 4, gap: 8, borderRadius: radius.md },
  keptWho: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  keptMark: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  flexText: { flex: 1, minWidth: 0 },
  keptName: { fontFamily: font.sansBold, fontSize: 15, lineHeight: 20 },
  keptSub: { fontFamily: font.sans, fontSize: 12, lineHeight: 16 },
  quote: { paddingLeft: 10, borderLeftWidth: 3, fontFamily: font.sansSemi, fontSize: 16, lineHeight: 24 },
  fromBox: { alignSelf: 'flex-start' },
  from: { height: 44, flexDirection: 'row', alignItems: 'center', gap: 4 },
  fromText: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18, textDecorationLine: 'underline' },
  fromGap: { height: 8 },
  written: { fontFamily: font.sans, fontSize: 16, lineHeight: RULE },
  noKept: { paddingTop: 4, fontFamily: font.sans, fontSize: 13, lineHeight: 18 },
});

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { ConsolePressable } from '@/components/console/ConsolePressable';
import {
  adminApi,
  type AdminFeedbackPage,
  type FeedbackCategory,
  type FeedbackRole,
} from '@/lib/adminApi';
import { formatTimestamp } from '@/lib/format';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type, wash, washInk } from '@/theme/tokens';

const PAGE = 25;
/** Board A11's three chips, in the words the member tapped. */
const CATEGORIES: { key: FeedbackCategory; label: string }[] = [
  { key: 'broken', label: "Something's broken" },
  { key: 'confusing', label: 'This is confusing' },
  { key: 'idea', label: 'I have an idea' },
];
const ROLES: { key: FeedbackRole; label: string }[] = [
  { key: 'member', label: 'Members' },
  { key: 'mentor', label: 'Mentors' },
];

/**
 * What people told the team through the Feedback sheet (board A11). A note has no author —
 * only which side of the app it came from, the screen's route template and the app
 * version. `GET /admin/feedback` writes a `feedback.viewed` audit row per read, because
 * people write freely in that box. Newest first, 25 a page.
 */
export default function FeedbackPanel() {
  const { colors } = useTheme();
  const [page, setPage] = useState<AdminFeedbackPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [role, setRole] = useState<FeedbackRole | null>(null);

  const load = useCallback(async () => {
    try {
      setPage(await adminApi.feedback({ limit: PAGE, offset, category, role }));
      setError(null);
    } catch {
      setError('Could not load feedback. Retry shortly.');
    }
  }, [offset, category, role]);

  useEffect(() => {
    void load();
  }, [load]);

  const filter = <K extends string>(
    key: K | null,
    current: K | null,
    label: string,
    onPick: (k: K | null) => void,
    testID: string,
  ) => {
    const on = key === current;
    return (
      <ConsolePressable
        key={testID}
        onPress={() => {
          setOffset(0);
          onPick(key);
        }}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        testID={testID}
        style={[
          styles.chip,
          on
            ? { backgroundColor: colors.ink, borderColor: colors.ink }
            : { backgroundColor: colors.surface, borderColor: colors.border },
        ]}
        hoverStyle={on ? undefined : { backgroundColor: colors.surfaceAlt }}
      >
        <Text style={[type.label, { color: on ? colors.onBrand : colors.ink }]}>{label}</Text>
      </ConsolePressable>
    );
  };

  const tone = (c: FeedbackCategory) =>
    c === 'broken'
      ? { backgroundColor: wash.danger, color: washInk.danger }
      : c === 'confusing'
        ? { backgroundColor: wash.orange, color: washInk.orange }
        : { backgroundColor: wash.green, color: washInk.green };

  const total = page?.total ?? 0;
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + PAGE, total);

  return (
    <View style={styles.body} testID="admin-panel-feedback">
      <View style={styles.headText}>
        <Text style={[type.eyebrow, { color: colors.inkMuted }]}>Admin · Feedback</Text>
        <Text style={[type.displayHeadline, styles.h1, { color: colors.ink }]} accessibilityRole="header">
          What people <Text style={{ color: colors.accent }}>told us</Text>
        </Text>
        <Text style={[type.note, { color: colors.inkMuted }]}>
          No author is ever stored — only the side of the app, the screen and the app version. Phone numbers and emails
          are redacted before a note is saved. Every read of this list is audited.
        </Text>
      </View>

      <View style={styles.filters}>
        {filter<FeedbackCategory>(null, category, 'All notes', setCategory, 'feedback-cat-all')}
        {CATEGORIES.map((c) => filter(c.key, category, c.label, setCategory, `feedback-cat-${c.key}`))}
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        {filter<FeedbackRole>(null, role, 'Both sides', setRole, 'feedback-role-all')}
        {ROLES.map((r) => filter(r.key, role, r.label, setRole, `feedback-role-${r.key}`))}
      </View>

      {error ? (
        <Text style={[type.caption, { color: colors.danger }]}>{error}</Text>
      ) : !page ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : page.items.length === 0 ? (
        <Text style={[type.body, { color: colors.inkMuted }]} testID="feedback-empty">
          No notes here yet.
        </Text>
      ) : (
        <View style={styles.list}>
          {page.items.map((f) => (
            <EdgeSurface
              key={f.id}
              edge={colors.edgeSurface}
              style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
              testID={`feedback-item-${f.id}`}
            >
              <View style={styles.meta}>
                <Text style={[styles.tag, tone(f.category)]}>
                  {CATEGORIES.find((c) => c.key === f.category)?.label ?? f.category}
                </Text>
                <Text style={[type.caption, { color: colors.inkMuted }]}>
                  {f.role === 'mentor' ? 'Mentor' : 'Member'}
                  {f.screen ? ` · ${f.screen}` : ''}
                  {f.app_version ? ` · ${f.app_version}` : ''}
                </Text>
                <Text style={[type.caption, styles.date, { color: colors.inkMuted }]}>
                  {formatTimestamp(f.created_at)}
                </Text>
              </View>
              <Text style={[type.body, { color: colors.ink }]} selectable>
                {f.text}
              </Text>
            </EdgeSurface>
          ))}
        </View>
      )}

      {page && total > 0 ? (
        <View style={styles.pager}>
          <Text style={[type.caption, { color: colors.inkMuted }]} testID="feedback-range">
            {from}–{to} of {total}
          </Text>
          <ConsolePressable
            onPress={() => setOffset(Math.max(0, offset - PAGE))}
            disabled={offset === 0}
            accessibilityRole="button"
            testID="feedback-newer"
            style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }, offset === 0 && styles.off]}
          >
            <Text style={[type.label, { color: colors.ink }]}>Newer</Text>
          </ConsolePressable>
          <ConsolePressable
            onPress={() => setOffset(offset + PAGE)}
            disabled={to >= total}
            accessibilityRole="button"
            testID="feedback-older"
            style={[styles.chip, { backgroundColor: colors.surface, borderColor: colors.border }, to >= total && styles.off]}
          >
            <Text style={[type.label, { color: colors.ink }]}>Older</Text>
          </ConsolePressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: 20, paddingVertical: space.md },
  center: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  headText: { gap: 2, maxWidth: 720 },
  h1: { lineHeight: 36 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  divider: { width: 1, height: 28, marginHorizontal: space.xs },
  chip: {
    height: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  off: { opacity: 0.45 },
  list: { gap: 14 },
  card: { paddingVertical: space.md, paddingHorizontal: 20, borderWidth: 1, borderRadius: radius.lg, gap: space.sm },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
  tag: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    overflow: 'hidden',
    ...type.chip,
    lineHeight: 26,
  },
  date: { marginLeft: 'auto' },
  pager: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.sm },
});

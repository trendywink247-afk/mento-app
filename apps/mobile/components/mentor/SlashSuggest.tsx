import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { useI18n } from '@/lib/i18n';
import type { PreparedAnswer } from '@/lib/preparedAnswersCore';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/**
 * The list a mentor sees after typing "/" in a chat (founder, 2026-11-08): their prepared answers
 * that match. Choosing one fills the box; the mentor reads it, may edit it, and sends it. Nothing
 * here sends. With no answers saved yet, it says where to make them.
 */
export function SlashSuggest({
  items,
  hasAnswers,
  onPick,
  onManage,
}: {
  items: PreparedAnswer[];
  hasAnswers: boolean;
  onPick: (a: PreparedAnswer) => void;
  onManage: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <View style={styles.wrap} testID="slash-suggest">
      <EdgeSurface edge={colors.edgeSurface} radius={radius.lg} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {items.length ? (
          items.map((a, i) => (
            <Pressable
              key={a.id}
              onPress={() => onPick(a)}
              accessibilityRole="button"
              accessibilityLabel={`/${a.shortcut}. ${a.body}`}
              style={[styles.row, i === 0 && { backgroundColor: colors.accentTint }]}
              testID={`slash-item-${a.shortcut}`}
            >
              <View style={styles.head}>
                <View style={[styles.chip, { backgroundColor: i === 0 ? colors.surface : colors.accentTint }]}>
                  <Text style={[type.caption, { color: colors.accentEdge, fontFamily: type.label.fontFamily }]}>/{a.shortcut}</Text>
                </View>
              </View>
              <Text style={[type.body, { color: colors.ink }]} numberOfLines={2}>
                {a.body}
              </Text>
            </Pressable>
          ))
        ) : (
          <Pressable onPress={onManage} accessibilityRole="button" style={styles.row} testID="slash-empty">
            <Text style={[type.body, { color: colors.ink }]}>
              {hasAnswers ? t('answers.noMatch') : t('answers.noneYet')}
            </Text>
            {!hasAnswers ? <Text style={[type.label, { color: colors.accent }]}>{t('answers.add')}</Text> : null}
          </Pressable>
        )}
        {items.length ? <Text style={[type.caption, styles.note, { color: colors.inkMuted }]}>{t('answers.fillsOnly')}</Text> : null}
      </EdgeSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.md, paddingBottom: space.sm },
  card: { borderWidth: 1, padding: space.xs },
  row: { borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 8, gap: 2, minHeight: 44, justifyContent: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chip: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1 },
  title: { flex: 1, minWidth: 0 },
  note: { paddingHorizontal: 10, paddingBottom: 4 },
});

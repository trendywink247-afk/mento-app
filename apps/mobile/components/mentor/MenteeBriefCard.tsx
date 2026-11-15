import { StyleSheet, Text, View } from 'react-native';

import { useI18n, type TKey } from '@/lib/i18n';
import { languageLine } from '@/lib/languages';
import type { MenteeBrief } from '@/lib/listenerApi';
import { fieldsFor, type MarkField } from '@/lib/menteeForm';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

/**
 * What the member shared in the mentorship form (DECISIONS R.6, R.14), on the request the
 * mentor is reading. Never a name or contact. Marks appear only when the member allowed this
 * mentor's tier to see them; otherwise one line says they chose not to.
 */
export function MenteeBriefCard({ brief }: { brief: MenteeBrief }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const word = (prefix: string, v: string | null | undefined) => (v ? t(`intake.${prefix}_${v}` as TKey) : null);
  const facts = [
    brief.current_stage ? { k: t('intake.stage'), v: word('stage', brief.current_stage) } : null,
    brief.attempts_count != null ? { k: t('intake.attemptsCount'), v: String(brief.attempts_count) } : null,
    brief.furthest_stage ? { k: t('intake.furthest'), v: word('furthest', brief.furthest_stage) } : null,
    brief.optional_subject ? { k: t('intake.optional'), v: brief.optional_subject } : null,
    brief.prep_mode ? { k: t('intake.prep'), v: word('prep', brief.prep_mode) } : null,
    brief.language ? { k: t('intake.language'), v: languageLine([brief.language]) } : null,
    brief.help_with?.length ? { k: t('intake.help'), v: brief.help_with.map((h) => t(`intake.help_${h}` as TKey)).join(', ') } : null,
  ].filter((f): f is { k: string; v: string } => Boolean(f && f.v));
  const attempts = brief.attempts ?? [];
  return (
    <View style={styles.wrap} testID="mentee-brief">
      <Text style={[type.caption, styles.eyebrow, { color: colors.inkMuted }]}>{t('mentor.reqForm')}</Text>
      {facts.map((f) => (
        <View key={f.k} style={[styles.fact, { borderBottomColor: colors.border }]}>
          <Text style={[type.label, { color: colors.ink }]}>{f.k}</Text>
          <Text style={[type.body, styles.value, { color: colors.inkMuted }]}>{f.v}</Text>
        </View>
      ))}
      {brief.note ? <Text style={[type.body, { color: colors.ink }]}>{`“${brief.note}”`}</Text> : null}
      {attempts.map((a) => (
        <View key={a.year} style={styles.attempt} testID={`mentee-brief-attempt-${a.year}`}>
          <Text style={[type.label, { color: colors.ink }]}>
            {t('mentor.reqAttempt', { year: String(a.year), stage: t(`intake.${a.stage}` as TKey) })}
          </Text>
          {brief.marks_shown ? (
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              {fieldsFor(a.stage)
                .filter((f: MarkField) => a[f] != null)
                .map((f: MarkField) => `${t(`intake.${f}` as TKey)} ${a[f]}`)
                .join(' · ')}
            </Text>
          ) : null}
        </View>
      ))}
      {attempts.length && !brief.marks_shown ? (
        <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentor.reqMarksHidden')}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  eyebrow: { textTransform: 'uppercase', letterSpacing: 0.6, paddingTop: space.sm },
  fact: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  value: { flexShrink: 1, textAlign: 'right' },
  attempt: { gap: 2, paddingTop: 4 },
});

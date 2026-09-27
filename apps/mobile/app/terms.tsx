import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { BoardSheet, type BoardSheetHandle } from '@/components/motion/BoardSheet';
import { PressKey } from '@/components/motion/PressKey';
import { api } from '@/lib/api';
import { useI18n, type TKey } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, type } from '@/theme/tokens';

type Rule = { icon: keyof typeof Ionicons.glyphMap; lead: TKey; rest: TKey };

const RULES: Rule[] = [
  { icon: 'person-outline', lead: 'terms.adultsLead', rest: 'terms.adultsRest' },
  { icon: 'people-outline', lead: 'terms.peersLead', rest: 'terms.peersRest' },
  { icon: 'eye-off-outline', lead: 'terms.anonLead', rest: 'terms.anonRest' },
  { icon: 'heart-outline', lead: 'terms.kindLead', rest: 'terms.kindRest' },
  { icon: 'shield-checkmark-outline', lead: 'terms.safetyLead', rest: 'terms.safetyRest' },
];

/**
 * Mento's house rules (WS3 T3.9) as a board sheet over whatever opened it (the same
 * screens-backed transparent modal as app/start-fresh.tsx).
 *
 * `/terms` — read-only: the age step's "Read them" link (continuing there IS agreeing).
 * `/terms?ask=1` — the explicit ask for a member who joined before the app asked (the
 * tabs layout opens it when GET /me says `terms_required`): "I agree" records the
 * acceptance server-side (POST /me/terms), then the sheet closes.
 */
export default function TermsScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const { ask } = useLocalSearchParams<{ ask?: string }>();
  const asking = ask === '1';
  const sheet = useRef<BoardSheetHandle | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const agree = async () => {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      await api.acceptTerms();
      sheet.current?.close();
    } catch {
      setFailed(true);
      setSaving(false);
    }
  };

  return (
    <BoardSheet
      controller={sheet}
      onDismiss={() => router.back()}
      dismissLabel={t('terms.closeA11y')}
      testID="terms-modal"
      backdropTestID="terms-backdrop"
    >
      <View style={styles.head}>
        <Text style={[type.sheetTitle, { color: colors.ink }]} accessibilityRole="header">
          {t('terms.title')}
        </Text>
        <Text style={[type.bodySmall, { color: colors.ink }]}>{t('terms.sub')}</Text>
      </View>

      <EdgeSurface
        edge={colors.edgeSurface}
        travel={3}
        radius={radius.lg}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        {RULES.map((rule) => (
          <View key={rule.lead} style={styles.row}>
            <View style={[styles.disc, { backgroundColor: colors.bgLavender }]}>
              <Ionicons name={rule.icon} size={18} color={colors.ink} />
            </View>
            <Text style={[styles.rowText, { color: colors.inkMuted }]}>
              <Text style={[styles.rowLead, { color: colors.ink }]}>{t(rule.lead)}</Text> {t(rule.rest)}
            </Text>
          </View>
        ))}
        <Text style={[type.caption, { color: colors.inkMuted }]} testID="terms-draft">
          {t('terms.draft')}
        </Text>
      </EdgeSurface>

      {/* Still, like every limit state: a line, never a shake. */}
      {failed ? (
        <Text style={[type.note, { color: colors.ink }]} accessibilityLiveRegion="polite">
          {t('terms.failed')}
        </Text>
      ) : null}

      <PressKey
        onPress={asking ? () => void agree() : () => sheet.current?.close()}
        disabled={saving}
        edge={asking ? colors.accentEdge : colors.edgeSurface}
        radius={radius.md}
        testID={asking ? 'terms-agree' : 'terms-close'}
        style={[
          styles.key,
          asking
            ? { backgroundColor: colors.accent }
            : [styles.keyPlain, { backgroundColor: colors.surface, borderColor: colors.border }],
        ]}
      >
        {saving ? (
          <ActivityIndicator color={colors.onBrand} />
        ) : (
          <Text
            style={[styles.keyText, { color: asking ? colors.onBrand : colors.ink }]}
            numberOfLines={1}
            adjustsFontSizeToFit
          >
            {asking ? t('terms.agree') : t('terms.close')}
          </Text>
        )}
      </PressKey>
    </BoardSheet>
  );
}

const styles = StyleSheet.create({
  head: { gap: 4 },
  card: { paddingVertical: 12, paddingHorizontal: 14, gap: 10, borderWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  disc: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0, fontFamily: font.sans, fontSize: 15, lineHeight: 20 },
  rowLead: { fontFamily: font.sansBold },
  key: { height: 58, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  keyPlain: { borderWidth: 1 },
  keyText: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 24 },
});

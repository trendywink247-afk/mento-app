import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

/** The recovery code on Profile (WS3 T3.5). An anonymous account has no email or
 * password; this code is the member's own way back on a new phone.
 *
 * The code is shown ONCE, right after it is made, with "Mento will never ask you for
 * this" — the one line that defeats someone posing as the team. Leaving the card (or
 * tapping "I've saved it") forgets it; the server keeps only a hash. */
export function RecoveryCard({ hasCode }: { hasCode: boolean }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [phrase, setPhrase] = useState<string | null>(null);
  const [has, setHas] = useState(hasCode);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  const make = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    setCopied(false);
    try {
      setPhrase((await api.makeRecoveryCode()).phrase);
      setHas(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!phrase) return;
    try {
      await Clipboard.setStringAsync(phrase);
      setCopied(true);
    } catch {
      /* the code is on screen to write down either way */
    }
  };

  return (
    <EdgeSurface
      edge={colors.edgeSurface}
      travel={3}
      radius={radius.md}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      testID="profile-recovery"
    >
      <View style={styles.head}>
        <IconBadge icon="key-outline" tone="indigo" size={36} />
        <View style={styles.text}>
          <Text style={[styles.title, { color: colors.ink }]}>{t('recovery.title')}</Text>
          {!phrase ? (
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              {has ? t('recovery.bodyHas') : t('recovery.bodyNone')}
            </Text>
          ) : null}
        </View>
      </View>

      {phrase ? (
        <View style={styles.reveal}>
          <View style={[styles.codeBox, { backgroundColor: colors.bgLavender }]}>
            <Text
              style={[styles.code, { color: colors.ink }]}
              selectable
              accessibilityLabel={phrase.split('').join(' ')}
              testID="recovery-phrase"
            >
              {phrase}
            </Text>
          </View>
          <View style={styles.never}>
            <Ionicons name="shield-checkmark-outline" size={18} color={colors.ink} />
            <Text style={[type.bodySmall, styles.neverText, { color: colors.ink }]} testID="recovery-never-ask">
              {t('recovery.neverAsk')}
            </Text>
          </View>
          <Text style={[type.caption, { color: colors.inkMuted }]}>{t('recovery.keep')}</Text>
          <PrimaryButton
            label={copied ? t('recovery.copied') : t('recovery.copy')}
            variant="surface"
            onPress={() => void copy()}
            testID="recovery-copy"
          />
          <PrimaryButton label={t('recovery.done')} onPress={() => setPhrase(null)} testID="recovery-done" />
        </View>
      ) : (
        <>
          {/* Still, like every limit state: a line, never a shake. */}
          {failed ? <Text style={[type.note, { color: colors.ink }]}>{t('recovery.failed')}</Text> : null}
          <PrimaryButton
            label={has ? t('recovery.makeNew') : t('recovery.make')}
            variant={has ? 'surface' : 'primary'}
            onPress={() => void make()}
            loading={busy}
            testID="recovery-make"
          />
        </>
      )}
    </EdgeSurface>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: space.sm, borderWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  text: { flex: 1, minWidth: 0 },
  title: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 22 },
  reveal: { gap: space.sm },
  codeBox: { borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 12, alignItems: 'center' },
  code: { fontFamily: font.sansBold, fontSize: 18, lineHeight: 26, letterSpacing: 1, textAlign: 'center' },
  never: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  neverText: { flex: 1, fontFamily: font.sansSemi },
});

import { Ionicons } from '@expo/vector-icons';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { IconBadge } from '@/components/IconBadge';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n, type TKey } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS } from '@/theme/companion';
import { radius, space, type } from '@/theme/tokens';

/** Verified India crisis helplines (T&S #1) — exactly these two, re-verified session 29,
 * see docs/PRIVACY.md sourcing. */
const HELPLINES = [
  { key: 'teleManas', number: '14416' },
  { key: 'kiran', number: '1800-599-0019' },
] as const;

/** Board A35's still panel: "Helplines to point to". Nothing in it moves — a heavy
 * moment gets stillness (T&S #11). Each number is a real `tel:` link: an <a href> on
 * web, Linking on native. */
export function HelplinesSheet({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const sageInk = COMPANION_COLORS.sage.accentEdge;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.bg, borderColor: colors.border }]}
      testID="helplines-sheet"
      accessibilityRole="none"
      accessibilityLabel={t('mentorChatPage.helplinesTitle')}
    >
      <View style={styles.head}>
        <IconBadge icon="call-outline" tone="green" size={40} />
        <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
          {t('mentorChatPage.helplinesTitle')}
        </Text>
        <PressKey
          onPress={onClose}
          edge={colors.edgeSurface}
          travel={3}
          radius={radius.pill}
          accessibilityLabel={t('mentorChatPage.close')}
          testID="helplines-close"
          style={[styles.close, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Ionicons name="close" size={20} color={colors.ink} />
        </PressKey>
      </View>
      <Text style={[type.bodySmall, styles.body, { color: colors.ink }]}>{t('mentorChatPage.helplinesBody')}</Text>
      <View style={styles.rows}>
        {HELPLINES.map(({ key, number }) => {
          const name = t(`mentorChatPage.${key}` as TKey);
          const tel = `tel:${number.replace(/-/g, '')}`;
          // reason: react-native-web renders a Text with `href` as a real <a href>; the
          // prop is not in RN's Text types. Native has no href, so it opens via Linking.
          const link =
            Platform.OS === 'web'
              ? ({ href: tel } as object)
              : { onPress: () => void Linking.openURL(tel).catch(() => {}) };
          return (
            <EdgeSurface
              key={key}
              edge={colors.edgeSurface}
              radius={radius.md}
              style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
              testID={`helpline-${key}`}
            >
              <Text style={[type.cardTitle, { color: colors.ink }]}>{name}</Text>
              <Text
                {...link}
                accessibilityRole="link"
                accessibilityLabel={t('mentorChatPage.callA11y', { name, number })}
                style={[styles.number, { color: sageInk }]}
              >
                {number}
              </Text>
            </EdgeSurface>
          );
        })}
      </View>
      <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentorChatPage.helplinesFoot')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 420,
    padding: space.md,
    gap: 12,
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, fontSize: 19, lineHeight: 24, fontFamily: type.displayHeadline.fontFamily },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  body: { lineHeight: 22 },
  rows: { gap: space.sm },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: space.md,
    borderWidth: 1,
  },
  number: { fontSize: 20, lineHeight: 44, fontFamily: type.displayHeadline.fontFamily, minHeight: 44, textDecorationLine: 'none' },
});

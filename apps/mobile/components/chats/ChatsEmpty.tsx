import { StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Companion } from '@/components/art/Companion';
import { Entrance } from '@/components/motion/Entrance';
import { useBreathing } from '@/components/motion/useBreathing';
import { useI18n } from '@/lib/i18n';
import { useCompanionAnimal } from '@/lib/useCompanionAnimal';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/** The companion's size on the empty stage — the board's hero scale (A03 / A23), not a perch. */
const COMPANION = 132;

/**
 * My Chats before the first conversation (board A06's language for a member with nothing
 * yet): the member's own companion standing on its shelf, one calm line, and the primary
 * "Start a conversation" key into the New chat sheet (A24). The companion is already there
 * (FINAL_SPEC: it never arrives); the words and the key rise in reading order. The screen
 * that hosts this must not also draw the perched companion — one companion per screen.
 */
export function ChatsEmpty({ onStart }: { onStart: () => void }) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const animal = useCompanionAnimal();
  const breath = useBreathing(true);

  return (
    <View style={styles.root} testID="chats-empty">
      <View style={styles.stage} accessible accessibilityRole="image" accessibilityLabel={t('chatsEmpty.companionA11y')}>
        <View style={[styles.shelf, { backgroundColor: colors.edgeSurface }]} />
        <Animated.View style={[styles.feet, breath]}>
          <Companion animal={animal ?? null} size={COMPANION} awake />
        </Animated.View>
      </View>
      <Entrance index={1} style={styles.words}>
        <Text style={[type.title, styles.center, { color: colors.ink }]} accessibilityRole="header">
          {t('chats.emptyTitle')}
        </Text>
        <Text style={[type.body, styles.center, { color: colors.inkMuted }]}>{t('chats.emptyBody')}</Text>
      </Entrance>
      <Entrance index={2} style={styles.cta}>
        <PrimaryButton
          label={t('chats.startCta')}
          shape="key"
          icon="add"
          onPress={onStart}
          accessibilityLabel={t('chats.newChatA11y')}
          testID="start-from-chats"
        />
      </Entrance>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md, paddingHorizontal: space.lg, paddingBottom: space.xl },
  stage: { width: COMPANION + 40, height: COMPANION + 8, alignItems: 'center', justifyContent: 'flex-end' },
  shelf: { position: 'absolute', left: 24, right: 24, bottom: 0, height: 22, borderRadius: radius.pill },
  feet: { marginBottom: 8, transformOrigin: 'bottom' },
  words: { gap: space.xs, alignSelf: 'stretch' },
  center: { textAlign: 'center' },
  cta: { alignSelf: 'stretch', marginTop: space.xs },
});

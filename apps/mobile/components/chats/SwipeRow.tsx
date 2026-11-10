import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RectButton } from 'react-native-gesture-handler';
import Swipeable from 'react-native-gesture-handler/ReanimatedSwipeable';

import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius } from '@/theme/tokens';

/** Slide a chat left to reach Archive and Delete (the same two actions the long-press offers). */
export function SwipeRow({
  children,
  archived,
  onArchive,
  onDelete,
}: {
  children: ReactNode;
  archived: boolean;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <Swipeable
      overshootRight={false}
      friction={2}
      rightThreshold={40}
      renderRightActions={(_p, _t, swipe) => (
        <View style={styles.actions}>
          <RectButton
            style={[styles.action, { backgroundColor: colors.accentTint }]}
            onPress={() => {
              swipe.close();
              onArchive();
            }}
            testID="swipe-archive"
          >
            <Ionicons name={archived ? 'arrow-undo-outline' : 'archive-outline'} size={22} color={colors.accentInk} />
            <Text style={[styles.label, { color: colors.accentInk }]}>{archived ? t('chatActions.unarchive') : t('chatActions.archive')}</Text>
          </RectButton>
          <RectButton
            style={[styles.action, { backgroundColor: colors.danger }]}
            onPress={() => {
              swipe.close();
              onDelete();
            }}
            testID="swipe-delete"
          >
            <Ionicons name="trash-outline" size={22} color={colors.onBrand} />
            <Text style={[styles.label, { color: colors.onBrand }]}>{t('chatActions.delete')}</Text>
          </RectButton>
        </View>
      )}
    >
      {children}
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', gap: 8, paddingLeft: 8 },
  action: { width: 84, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: radius.lg },
  label: { fontSize: 12, fontWeight: '700' },
});

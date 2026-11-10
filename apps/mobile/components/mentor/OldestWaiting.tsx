import { StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { MemberDisc } from '@/components/mentor/MemberDisc';
import { PressKey } from '@/components/motion/PressKey';
import { ageLabel } from '@/lib/age';
import { useI18n } from '@/lib/i18n';
import type { ListenerRequest } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/** Home's peek at the request that has waited longest (founder choice, 2026-11-08): accept it from
 * here, or open them all. Sits below the reading card. */
export function OldestWaiting({
  request,
  total,
  busy,
  onAccept,
  onSeeAll,
}: {
  request: ListenerRequest;
  total: number;
  busy: boolean;
  onAccept: () => void;
  onSeeAll: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  return (
    <EdgeSurface
      edge={colors.accentTintEdge}
      radius={radius.lg}
      style={[styles.card, { backgroundColor: colors.accentTint, borderColor: colors.accentTintEdge }]}
      testID="mentor-oldest-waiting"
    >
      <View style={styles.head}>
        <View style={[styles.chip, { backgroundColor: colors.surface }]}>
          <Text style={[type.caption, { color: colors.accentInk, fontFamily: type.label.fontFamily }]}>
            {t('mentor.oldestWaiting', { age: ageLabel(request.created_at) })}
          </Text>
        </View>
        <Text style={[type.caption, { color: colors.accentInk, fontFamily: type.label.fontFamily }]}>
          {t('mentor.waitingCount', { count: total })}
        </Text>
      </View>
      <View style={styles.who}>
        <MemberDisc
          name={request.requester_persona_name}
          size={40}
          animal={request.requester_companion_animal}
          colour={request.requester_companion_colour}
          still
        />
        <View style={styles.whoText}>
          <Text style={[type.label, { color: colors.ink }]}>{request.requester_persona_name}</Text>
          <Text style={[type.caption, { color: colors.accentInk }]}>
            {request.broadcast ? t('mentor.reqOpen') : t('mentor.reqAsked')}
          </Text>
        </View>
      </View>
      {request.intro_message ? (
        <Text style={[type.body, { color: colors.ink }]} numberOfLines={2}>
          {request.intro_message}
        </Text>
      ) : null}
      <View style={styles.keys}>
        <PressKey
          onPress={onAccept}
          edge={colors.accentEdge}
          travel={4}
          radius={radius.md}
          intent="commit"
          disabled={busy}
          containerStyle={styles.accept}
          style={[styles.face, { backgroundColor: colors.accent }]}
          testID="mentor-oldest-accept"
        >
          <Text style={[type.keyDense, { color: colors.onAccent }]}>{t('mentor.accept')}</Text>
        </PressKey>
        <PressKey
          onPress={onSeeAll}
          edge={colors.edgeSurface}
          travel={4}
          radius={radius.md}
          containerStyle={styles.seeAll}
          style={[styles.face, styles.bordered, { backgroundColor: colors.surface, borderColor: colors.border }]}
          testID="mentor-oldest-see-all"
        >
          <Text style={[type.keyDense, { color: colors.ink }]}>{t('mentor.seeAll')}</Text>
        </PressKey>
      </View>
    </EdgeSurface>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  who: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  whoText: { flex: 1, minWidth: 0 },
  keys: { flexDirection: 'row', gap: space.sm },
  accept: { flex: 1.4 },
  seeAll: { flex: 1 },
  face: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  bordered: { borderWidth: 1 },
});

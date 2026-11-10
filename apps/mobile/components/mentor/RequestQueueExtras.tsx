import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { MemberDisc } from '@/components/mentor/MemberDisc';
import { ageLabel } from '@/lib/age';
import { useI18n } from '@/lib/i18n';
import type { ListenerRequest } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/** Three small totals over the requests: how many wait, how long the oldest has, and how fast you usually reply. */
export function RequestTotals({
  requests,
  replyWithin,
}: {
  requests: ListenerRequest[];
  replyWithin?: 'day' | 'two_days' | null;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  if (!requests.length) return null;
  const oldest = requests.reduce((a, r) => (Date.parse(r.created_at) < Date.parse(a.created_at) ? r : a));
  const tiles = [
    { n: String(requests.length), l: t('mentor.reqTotWaiting') },
    { n: ageLabel(oldest.created_at), l: t('mentor.reqTotOldest') },
    replyWithin ? { n: replyWithin === 'day' ? t('mentor.reqTotDay') : t('mentor.reqTotTwoDays'), l: t('mentor.reqTotReply') } : null,
  ].filter(Boolean) as { n: string; l: string }[];
  return (
    <View style={styles.tiles} testID="mentor-request-totals">
      {tiles.map((x) => (
        <EdgeSurface key={x.l} edge={colors.edgeSurface} radius={radius.lg} containerStyle={styles.tileBox} style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.num, { color: colors.ink }]} numberOfLines={1}>
            {x.n}
          </Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>{x.l}</Text>
        </EdgeSurface>
      ))}
    </View>
  );
}

/** The other waiting requests, small, under the one being read. Tap one to read it next. */
export function UpNext({
  requests,
  current,
  onPick,
}: {
  requests: ListenerRequest[];
  current: number;
  onPick: (index: number) => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const rest = requests.map((r, i) => ({ r, i })).filter(({ i }) => i !== current);
  if (!rest.length) return null;
  return (
    <View style={styles.next} testID="mentor-request-upnext">
      <Text style={[type.caption, styles.eyebrow, { color: colors.inkMuted }]}>{t('mentor.reqUpNext')}</Text>
      {rest.slice(0, 4).map(({ r, i }) => (
        <Pressable key={r.id} onPress={() => onPick(i)} accessibilityRole="button" testID={`mentor-upnext-${r.id}`}>
          <EdgeSurface edge={colors.edgeSurface} radius={radius.lg} style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <MemberDisc name={r.requester_persona_name} size={40} animal={r.requester_companion_animal} colour={r.requester_companion_colour} still />
            <Text style={[type.label, styles.name, { color: colors.ink }]} numberOfLines={1}>
              {r.requester_persona_name}
            </Text>
            <Ionicons name={r.broadcast ? 'radio-outline' : 'person-outline'} size={14} color={colors.inkMuted} />
            <Text style={[type.caption, { color: colors.inkMuted }]}>{ageLabel(r.created_at)}</Text>
          </EdgeSurface>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: space.sm },
  tileBox: { flex: 1 },
  tile: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, gap: 0 },
  num: { fontSize: 22, lineHeight: 26, fontFamily: type.displaySerif.fontFamily },
  next: { gap: space.sm, marginTop: space.sm },
  eyebrow: { textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  name: { flex: 1 },
});

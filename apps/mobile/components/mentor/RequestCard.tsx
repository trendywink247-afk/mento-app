import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { MemberDisc } from '@/components/mentor/MemberDisc';
import { PressKey } from '@/components/motion/PressKey';
import { formatTopic } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { ListenerRequest } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS } from '@/theme/companion';
import { radius, space, type, wash } from '@/theme/tokens';

const INTRO_TRUNCATE_LEN = 160;

/** One Personal request awaiting accept / decline (board A10): the member's disc and
 * persona, what they picked at match, their intro (clipped to 3 lines with More/Less so
 * the keys never leave the screen), then Accept (the wider accent key) and Decline. */
export function RequestCard({
  request,
  busy,
  onAccept,
  onDecline,
}: {
  request: ListenerRequest;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const intro = request.intro_message ?? '';
  const canExpand = intro.length > INTRO_TRUNCATE_LEN;

  return (
    <EdgeSurface
      edge={colors.edgeSurface}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      testID={`mentor-request-${request.id}`}
    >
      <View style={styles.head}>
        <MemberDisc name={request.requester_persona_name} size={52} />
        <View style={styles.headText}>
          <Text style={[styles.name, { color: colors.ink }]}>{request.requester_persona_name}</Text>
          {request.issue_category ? (
            <View style={styles.chips}>
              <View style={[styles.chip, { backgroundColor: wash.orange }]}>
                <Text style={[styles.chipText, { color: COMPANION_COLORS.mustard.accentEdge }]}>
                  {t('mentorHomePage.pickedAtMatch', { topic: formatTopic(request.issue_category) })}
                </Text>
              </View>
            </View>
          ) : null}
        </View>
      </View>

      {intro ? (
        <>
          <Text style={[type.bodySmall, { color: colors.ink }]} numberOfLines={expanded ? undefined : 3}>
            {intro}
          </Text>
          {canExpand ? (
            <PressKey
              onPress={() => setExpanded((v) => !v)}
              edge="transparent"
              travel={2}
              haptic="none"
              containerStyle={styles.moreContainer}
              style={styles.more}
            >
              <Text style={[type.label, { color: colors.accent }]}>{expanded ? t('mentor.less') : t('mentor.more')}</Text>
            </PressKey>
          ) : null}
        </>
      ) : null}

      <View style={styles.actions}>
        <PressKey
          onPress={onAccept}
          edge={colors.accentEdge}
          travel={4}
          radius={radius.md}
          intent="commit"
          disabled={busy}
          containerStyle={styles.accept}
          style={[styles.actionFace, { backgroundColor: colors.accent }]}
          testID={`mentor-accept-${request.id}`}
        >
          <Text style={[type.keyDense, { color: colors.onAccent }]}>{t('mentor.accept')}</Text>
        </PressKey>
        <PressKey
          onPress={onDecline}
          edge={colors.edgeSurface}
          travel={4}
          radius={radius.md}
          disabled={busy}
          containerStyle={styles.decline}
          style={[styles.actionFace, styles.bordered, { backgroundColor: colors.surface, borderColor: colors.border }]}
          testID={`mentor-decline-${request.id}`}
        >
          <Text style={[type.keyDense, { color: colors.ink }]}>{t('mentor.decline')}</Text>
        </PressKey>
      </View>
    </EdgeSurface>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 12, borderWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headText: { flex: 1, minWidth: 0, gap: space.xs },
  name: { fontSize: 17, lineHeight: 22, fontFamily: type.label.fontFamily },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { minHeight: 24, paddingHorizontal: 10, borderRadius: radius.pill, justifyContent: 'center' },
  chipText: { fontSize: 12, lineHeight: 16, fontFamily: type.label.fontFamily },
  moreContainer: { alignSelf: 'flex-start' },
  more: { minHeight: 32, justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: 12, paddingBottom: space.xs },
  accept: { flex: 1.3 },
  decline: { flex: 1 },
  actionFace: { height: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.md },
  bordered: { borderWidth: 1 },
});

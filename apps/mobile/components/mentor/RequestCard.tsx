import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { EdgeSurface } from '@/components/EdgeSurface';
import { PressKey } from '@/components/motion/PressKey';
import { formatTopic } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import type { ListenerRequest } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

const INTRO_TRUNCATE_LEN = 160;

/** One Personal request awaiting accept/decline. The intro message can run long —
 * clipped to 3 lines with a More/Less toggle rather than ever pushing the actions
 * off-screen. */
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
      style={[styles.card, { backgroundColor: colors.surface }]}
      testID={`mentor-request-${request.id}`}
    >
      <View style={styles.head}>
        <PersonaAvatar name={request.requester_persona_name} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: colors.ink }]}>{request.requester_persona_name}</Text>
          {request.issue_category ? (
            <View style={[styles.chip, { backgroundColor: colors.surfaceAlt }]}>
              <Text style={[type.caption, { color: colors.accent }]}>
                {formatTopic(request.issue_category)}
              </Text>
            </View>
          ) : null}
        </View>
      </View>

      {intro ? (
        <>
          <Text style={[type.body, { color: colors.ink }]} numberOfLines={expanded ? undefined : 3}>
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
              <Text style={[type.caption, { color: colors.accent }]}>
                {expanded ? t('mentor.less') : t('mentor.more')}
              </Text>
            </PressKey>
          ) : null}
        </>
      ) : null}

      <View style={styles.actions}>
        <PressKey
          onPress={onAccept}
          edge={colors.accentEdge}
          disabled={busy}
          containerStyle={{ flex: 1 }}
          style={[styles.actionFace, { backgroundColor: colors.accent }]}
          testID={`mentor-accept-${request.id}`}
        >
          <Text style={[type.bodySemi, { color: colors.onAccent }]}>{t('mentor.accept')}</Text>
        </PressKey>
        <PressKey
          onPress={onDecline}
          edge={colors.edgeAlt}
          disabled={busy}
          containerStyle={{ flex: 1 }}
          style={[styles.actionFace, { backgroundColor: colors.surfaceAlt }]}
          testID={`mentor-decline-${request.id}`}
        >
          <Text style={[type.bodySemi, { color: colors.ink }]}>{t('mentor.decline')}</Text>
        </PressKey>
      </View>
    </EdgeSurface>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space.md, gap: space.sm, marginBottom: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  chip: {
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: space.sm,
    marginTop: space.xs,
  },
  moreContainer: { alignSelf: 'flex-start' },
  more: { minHeight: 32, justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: space.sm, marginTop: space.xs },
  actionFace: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
});

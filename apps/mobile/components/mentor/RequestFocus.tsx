import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { MemberDisc } from '@/components/mentor/MemberDisc';
import { PressKey } from '@/components/motion/PressKey';
import { ageLabel } from '@/lib/age';
import { useI18n } from '@/lib/i18n';
import type { ListenerRequest } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS } from '@/theme/companion';
import { radius, space, type, wash, washInk } from '@/theme/tokens';

/**
 * One request at a time, large enough to read (founder choice, 2026-11-08), with what the member
 * chose to share: their road, stage and topic. Never a name or contact. Accept opens the chat,
 * Decline answers no (an open request stays for other mentors), Next moves on without answering.
 */
export function RequestFocus({
  request,
  busy,
  onAccept,
  onDecline,
  onNext,
  canNext,
}: {
  request: ListenerRequest;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onNext: () => void;
  canNext: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const topic = request.issue_category_label ?? request.issue_category ?? null;
  const context = [
    request.community_label ? { text: request.community_label, tone: 'sky' as const } : null,
    request.stage_label ? { text: request.stage_label, tone: 'sky' as const } : null,
    topic ? { text: topic, tone: 'orange' as const } : null,
  ].filter(Boolean) as { text: string; tone: 'sky' | 'orange' }[];

  return (
    <View style={styles.wrap} testID={`mentor-request-${request.id}`}>
      <EdgeSurface edge={colors.edgeSurface} radius={radius.lg} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.head}>
          <MemberDisc
            name={request.requester_persona_name}
            size={56}
            animal={request.requester_companion_animal}
            colour={request.requester_companion_colour}
            still
          />
          <View style={styles.headText}>
            <Text style={[styles.name, { color: colors.ink }]} numberOfLines={1}>
              {request.requester_persona_name}
            </Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              {(request.broadcast ? t('mentor.reqOpen') : t('mentor.reqAsked')) + ' · ' + ageLabel(request.created_at)}
            </Text>
          </View>
        </View>
        {request.intro_message ? (
          <Text style={[styles.intro, { color: colors.ink }]}>{request.intro_message}</Text>
        ) : null}
      </EdgeSurface>

      {context.length ? (
        <EdgeSurface edge={colors.edgeAlt} radius={radius.lg} style={[styles.card, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
          <Text style={[type.caption, styles.eyebrow, { color: colors.inkMuted }]}>{t('mentor.reqAbout')}</Text>
          <View style={styles.chips}>
            {context.map((c) => (
              <View key={c.text} style={[styles.chip, { backgroundColor: c.tone === 'sky' ? wash.sky : wash.orange }]}>
                <Text style={[type.caption, { color: c.tone === 'sky' ? COMPANION_COLORS.sky.accentEdge : washInk.orange, fontFamily: type.label.fontFamily }]}>
                  {c.text}
                </Text>
              </View>
            ))}
          </View>
          <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentor.reqAboutNote')}</Text>
        </EdgeSurface>
      ) : null}

      <View style={[styles.safety, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
        <Ionicons name="shield-checkmark-outline" size={20} color={washInk.green} />
        <Text style={[type.caption, styles.safetyText, { color: colors.ink }]}>{t('mentorPrimer.row3Body')}</Text>
      </View>

      <PressKey
        onPress={onAccept}
        edge={colors.accentEdge}
        travel={4}
        radius={radius.md}
        intent="commit"
        disabled={busy}
        style={[styles.face, { backgroundColor: colors.accent }]}
        testID={`mentor-accept-${request.id}`}
      >
        <Text style={[type.key, { color: colors.onAccent }]}>{t('mentor.reqAcceptOpen')}</Text>
      </PressKey>
      <View style={styles.keys}>
        <PressKey
          onPress={onDecline}
          edge={colors.edgeSurface}
          travel={4}
          radius={radius.md}
          disabled={busy}
          containerStyle={styles.half}
          style={[styles.face, styles.bordered, { backgroundColor: colors.surface, borderColor: colors.border }]}
          testID={`mentor-decline-${request.id}`}
        >
          <Text style={[type.keyDense, { color: colors.ink }]}>{t('mentor.decline')}</Text>
        </PressKey>
        {canNext ? (
          <PressKey
            onPress={onNext}
            edge={colors.edgeAlt}
            travel={4}
            radius={radius.md}
            containerStyle={styles.half}
            style={[styles.face, styles.bordered, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
            testID="mentor-request-next"
          >
            <Text style={[type.keyDense, { color: colors.ink }]}>{t('mentor.reqNext')}</Text>
          </PressKey>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  card: { borderWidth: 1, padding: space.md, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  headText: { flex: 1, minWidth: 0 },
  name: { fontSize: 24, lineHeight: 30, fontFamily: type.displaySerif.fontFamily },
  intro: { ...type.body, fontSize: 18, lineHeight: 26 },
  eyebrow: { textTransform: 'uppercase', letterSpacing: 0.6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  safety: { flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1, borderRadius: radius.md, padding: 10 },
  safetyText: { flex: 1 },
  face: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  bordered: { borderWidth: 1 },
  keys: { flexDirection: 'row', gap: space.sm },
  half: { flex: 1 },
});

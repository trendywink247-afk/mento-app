import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { MemberDisc } from '@/components/mentor/MemberDisc';
import { PressKey } from '@/components/motion/PressKey';
import { useI18n } from '@/lib/i18n';
import type { MemberBrief } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { COMPANION_COLORS, accentFor } from '@/theme/companion';
import { radius, space, type, wash, washEdge } from '@/theme/tokens';

/** The mentor chat's header card (board A35) — the member's header mirrored: their
 * companion in THEIR colour on a disc, their persona, "Member · here now"; the options
 * key; and the path strip below with the labelled Helplines key always in reach. */
export function MentorChatHeader({
  memberName,
  brief,
  here,
  masked,
  onBack,
  onOpenBrief,
  onOptions,
  onHelplines,
}: {
  memberName: string;
  brief: MemberBrief | null;
  here: boolean;
  masked: boolean;
  onBack: () => void;
  onOpenBrief: () => void;
  onOptions: () => void;
  onHelplines: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const plum = COMPANION_COLORS.plum.accentEdge;
  const sage = COMPANION_COLORS.sage.accentEdge;
  const path = [brief?.community_label, brief?.journey_stage_label].filter(Boolean).join(' · ');
  const presence = masked ? t('mentor.masked') : here ? t('mentorChatPage.memberHere') : t('mentorChatPage.member');

  return (
    <EdgeSurface
      edge={colors.edgeSurface}
      travel={4}
      radius={radius.lg}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      testID="mentor-chat-header"
    >
      <View style={styles.top}>
        <PressKey
          onPress={onBack}
          edge="transparent"
          travel={2}
          radius={radius.pill}
          haptic="none"
          accessibilityLabel={t('mentorChatPage.back')}
          testID="mentor-chat-back"
          style={styles.back}
        >
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </PressKey>
        <PressKey
          onPress={onOpenBrief}
          edge="transparent"
          travel={2}
          radius={radius.md}
          intent="navigate"
          accessibilityLabel={t('mentorChatPage.headerA11y', { name: memberName })}
          containerStyle={styles.whoWrap}
          style={styles.who}
          testID="member-header"
        >
          <View style={styles.discWrap}>
            <MemberDisc
              name={memberName}
              size={56}
              animal={brief?.companion_animal}
              colour={brief?.companion_colour}
              ring={brief?.companion_animal ? accentFor(brief.companion_colour).accentTintEdge : undefined}
            />
            {here && !masked ? (
              <View style={[styles.dot, { backgroundColor: colors.success, borderColor: colors.surface }]} />
            ) : null}
          </View>
          <View style={styles.whoText}>
            <Text style={[styles.name, { color: colors.ink }]} numberOfLines={1}>
              {memberName}
            </Text>
            <View style={styles.presenceRow}>
              <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={1}>
                {presence}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={colors.inkMuted} />
            </View>
          </View>
        </PressKey>
        <PressKey
          onPress={onOptions}
          edge={colors.edgeAlt}
          travel={3}
          radius={radius.pill}
          accessibilityLabel={t('mentorChatPage.optionsA11y')}
          testID="mentor-chat-menu"
          style={[styles.options, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
        >
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.ink} />
        </PressKey>
      </View>

      <View style={[styles.strip, { backgroundColor: colors.surfaceAlt, borderTopColor: colors.border }]}>
        {path ? (
          <>
            <Text style={[styles.eyebrow, { color: colors.inkMuted }]}>{t('mentorChatPage.path')}</Text>
            <View style={[styles.pathChip, { backgroundColor: wash.indigo }]}>
              <Text style={[styles.chipText, { color: plum }]} numberOfLines={1}>
                {path}
              </Text>
            </View>
          </>
        ) : null}
        <View style={styles.grow} />
        <PressKey
          onPress={onHelplines}
          edge={washEdge.green}
          travel={3}
          radius={radius.pill}
          intent="navigate"
          testID="mentor-helplines"
          style={[styles.helplines, { backgroundColor: wash.green, borderColor: washEdge.green }]}
        >
          <Ionicons name="call-outline" size={18} color={sage} />
          <Text style={[type.label, { color: sage }]}>{t('mentorChatPage.helplines')}</Text>
        </PressKey>
      </View>
    </EdgeSurface>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, overflow: 'hidden', padding: 0 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: space.sm, paddingLeft: space.xs, paddingRight: space.sm },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  whoWrap: { flex: 1, minWidth: 0 },
  who: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'transparent' },
  discWrap: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', right: 0, bottom: 1, width: 14, height: 14, borderRadius: radius.pill, borderWidth: 2.5 },
  whoText: { flex: 1, minWidth: 0 },
  name: { fontSize: 19, lineHeight: 24, fontFamily: type.displayHeadline.fontFamily },
  presenceRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  options: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  strip: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: 12,
    paddingRight: space.sm,
    paddingBottom: 3,
    borderTopWidth: 1,
  },
  eyebrow: { fontSize: 12, lineHeight: 16, fontFamily: type.label.fontFamily, letterSpacing: 0.5, textTransform: 'uppercase' },
  pathChip: { height: 26, paddingHorizontal: 10, borderRadius: radius.pill, justifyContent: 'center', flexShrink: 1 },
  chipText: { fontSize: 12, lineHeight: 16, fontFamily: type.label.fontFamily },
  grow: { flexGrow: 1 },
  helplines: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 14,
    borderWidth: 1,
  },
});

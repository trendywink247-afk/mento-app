/**
 * Crisis support card (board A21) — renders the SERVER-injected crisis payload. The client
 * never scans: the helplines here are whatever the server's scan attached to the message
 * (Tele-MANAS 14416 and KIRAN 1800-599-0019, T&S #1).
 *
 * Support-and-refer, not alarm: a warm, deeper-oat card (never red), one plain sentence,
 * two LARGE call keys, and the reminder that the mentor is still here and is a peer, not a
 * therapist. "Why am I seeing this?" opens a short honest note.
 *
 * STILL (T&S #11): nothing on it animates, nothing arrives with a flourish, and the keys
 * have no press travel or haptic — the screen goes quiet around a person in crisis. The
 * composer below stays usable, and the companion is absent while the card shows (the
 * screens' placement hook hides it).
 *
 * `audience="mentor"` is the mentor console's view of the same payload: it says what the
 * member was shown, keeps both numbers visible, and drops the member-only lines.
 * `onDismiss`, when given, adds one quiet "Close" (the mentor console, and the native
 * member chat where the card sits above the thread rather than inside it).
 */
import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { IconBadge } from '@/components/IconBadge';
import { telHref } from '@/lib/helplines';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

export type CrisisPayload = {
  support: string;
  signal: string;
  helplines: { name: string; number: string; hours: string }[];
};

type Props = {
  crisis: CrisisPayload;
  /** The mentor's persona name, for "… is still here with you." (member side). */
  mentorName?: string;
  /** `feedback`: crisis words typed into the feedback sheet (board A11) — the member's lines
   * with a foot that does not speak of a mentor, and no "why" toggle about a chat message. */
  audience?: 'member' | 'mentor' | 'feedback';
  onDismiss?: () => void;
  /** Standing on its own between the header and the thread (default) it keeps the
   * screen's gutter; inside the thread's own column (web member chat) it does not. */
  inset?: boolean;
};

export function CrisisCard({ crisis, mentorName, audience = 'member', onDismiss, inset = true }: Props) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [whyOpen, setWhyOpen] = useState(false);
  const member = audience === 'member';

  return (
    <EdgeSurface
      edge={colors.edgeAlt}
      travel={3}
      radius={radius.lg}
      style={[styles.card, { backgroundColor: colors.bgLavender, borderColor: colors.borderStrong }]}
      containerStyle={[styles.wrap, inset && styles.inset]}
      testID="crisis-card"
    >
      <View style={styles.lead} accessibilityLabel={t('crisisCard.sectionA11y')}>
        <IconBadge icon="heart-outline" tone="orange" size={36} />
        <Text style={[styles.leadText, { color: colors.ink }]} accessibilityRole="header">
          {audience === 'mentor' ? t('crisisCard.mentorLead') : t('crisisCard.support')}
        </Text>
      </View>

      {crisis.helplines.map((h) => (
        // Still: a plain pressable on a drawn edge — no travel, no haptic.
        <Pressable
          key={h.number}
          onPress={() => void Linking.openURL(telHref(h.number))}
          accessibilityRole="link"
          accessibilityLabel={t('crisisCard.callA11y', { name: h.name, number: h.number })}
          testID={`crisis-call-${h.number.replace(/[^0-9]/g, '')}`}
        >
          <EdgeSurface
            edge={colors.edgeAlt}
            travel={4}
            radius={radius.md}
            style={[styles.callKey, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <IconBadge icon="call-outline" tone="green" size={36} />
            <View style={styles.callText}>
              <Text style={[styles.callName, { color: colors.ink }]} numberOfLines={1}>
                {h.name}
              </Text>
              <Text style={[type.caption, { color: colors.inkMuted }]} numberOfLines={1}>
                {t('crisisCard.free')}
              </Text>
            </View>
            <Text style={[styles.callNumber, { color: colors.ink }]} numberOfLines={1}>
              {h.number}
            </Text>
          </EdgeSurface>
        </Pressable>
      ))}

      <View style={styles.foot}>
        <Text style={[type.caption, { color: colors.inkMuted }]}>
          {member
            ? t('crisisCard.stillHere', { name: mentorName || t('chat.yourListener') })
            : audience === 'feedback'
              ? t('crisisCard.feedbackNote')
              : t('crisisCard.mentorNote')}
        </Text>
        {member && whyOpen ? (
          <Text style={[type.caption, styles.why, { color: colors.ink }]} testID="crisis-why-body">
            {t('crisisCard.whyBody')}
          </Text>
        ) : null}
        <View style={styles.links}>
          {member ? (
            <Pressable
              onPress={() => setWhyOpen((open) => !open)}
              accessibilityRole="button"
              accessibilityState={{ expanded: whyOpen }}
              testID="crisis-why"
              style={styles.link}
            >
              <Text style={[type.label, styles.underlined, { color: colors.inkMuted }]}>
                {whyOpen ? t('crisisCard.hide') : t('crisisCard.why')}
              </Text>
            </Pressable>
          ) : null}
          {onDismiss ? (
            <Pressable onPress={onDismiss} accessibilityRole="button" testID="crisis-close" style={styles.link}>
              <Ionicons name="close" size={14} color={colors.inkMuted} />
              <Text style={[type.label, styles.underlined, { color: colors.inkMuted }]}>{t('crisis.close')}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </EdgeSurface>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch' },
  inset: { marginHorizontal: space.md, marginVertical: space.sm },
  card: { paddingTop: space.md, paddingHorizontal: space.md, paddingBottom: 6, gap: 12, borderWidth: 1 },
  lead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  leadText: { flex: 1, fontFamily: font.sansBold, fontSize: 16, lineHeight: 22 },
  callKey: {
    height: 56,
    paddingLeft: 10,
    paddingRight: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
  },
  callText: { flex: 1, minWidth: 0 },
  callName: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 20 },
  callNumber: { fontFamily: font.sansHeavy, fontSize: 19, lineHeight: 24, letterSpacing: 0.2 },
  foot: { alignItems: 'flex-start' },
  why: { paddingTop: space.sm },
  links: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  link: { height: 44, flexDirection: 'row', alignItems: 'center', gap: space.xs },
  underlined: { textDecorationLine: 'underline' },
});

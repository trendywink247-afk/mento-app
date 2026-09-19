import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { BoardSheet, type BoardSheetHandle } from '@/components/motion/BoardSheet';
import { PressKey } from '@/components/motion/PressKey';
import { forgetAnalyticsId } from '@/lib/analytics';
import { ApiError, api } from '@/lib/api';
import { forgetPlacements } from '@/lib/companionPlacement';
import { useI18n, type TKey } from '@/lib/i18n';
import { clearListenerSession } from '@/lib/listenerSession';
import { disconnectListenerClient } from '@/lib/listenerStreamClient';
import { unregisterPush } from '@/lib/pushNotifications';
import { clearSession, getPersona, type Persona } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import { DEFAULT_COMPANION_COLOR } from '@/theme/companion';
import { dangerKeyEdge, font, radius, type, wash, washInk } from '@/theme/tokens';

/**
 * Start fresh (board A32) — a sheet over a settled-back Profile
 * (components/motion/BoardSheet.tsx). A limit state: its CONTENT is still — no arrivals on
 * the rows, no companion, no haptic on the destructive key.
 *
 * THE COPY IS WHAT THE CODE DOES (T&S #6 / #8). Confirm calls `DELETE /me` FIRST — the
 * server erases the member and everything keyed to them, on our servers and on Stream
 * (DECISIONS §L.11, services/api/app/services/erasure.py) — and only once it answers
 * "erased" does the device forget the session, persona, companion, role, placements, mentor
 * session and push registration. So the board's words are true: deleted from this device
 * AND from our servers. `e2e/start-fresh-copy.e2e.js` holds the sheet to the API.
 *
 * When the server cannot confirm (503 `erase_incomplete`, or no answer at all) nothing
 * leaves the device and one still line says so, with the key turned into "Try deleting
 * again" — the same session retries. A member who is ALSO a live mentor (409
 * `mentor_active`, or known up front from their approved application) is told calmly why
 * it cannot be done from here yet, and only "Keep my space" remains.
 *
 * A screens-backed `transparentModal` route, not an RN <Modal> (blank on Android new arch).
 */
const LEFT_BEHIND: { icon: keyof typeof Ionicons.glyphMap; lead: TKey; rest: TKey | null }[] = [
  { icon: 'chatbubble-outline', lead: 'startFresh.chats', rest: 'startFresh.chatsRest' },
  { icon: 'book-outline', lead: 'startFresh.journal', rest: 'startFresh.journalRest' },
  { icon: 'heart-outline', lead: 'startFresh.companion', rest: 'startFresh.companionRest' },
  { icon: 'compass-outline', lead: 'startFresh.path', rest: null },
];

export default function StartFreshSheet() {
  const router = useRouter();
  const { colors, setCompanionColor } = useTheme();
  const { t } = useI18n();
  const sheet = useRef<BoardSheetHandle | null>(null);
  const [persona, setPersona] = useState<Persona | null>(null);
  const [leaving, setLeaving] = useState(false);
  // Why the last try did not erase: the server ended the chats but could not finish, or we
  // never heard back. Either way nothing has left the device.
  const [failure, setFailure] = useState<'incomplete' | 'unreachable' | null>(null);
  // Also a live mentor: erasing would strand the people they talk with (DECISIONS §L.11 ii).
  const [mentorActive, setMentorActive] = useState(false);

  useEffect(() => {
    let active = true;
    void getPersona().then((p) => {
      if (active) setPersona(p);
    });
    // Known up front, so a mentor is never offered a key that can only be refused. The
    // server is still the judge (409 below) — this read only saves them the tap.
    void api
      .getListenerApplication()
      .then((a) => {
        if (active && a?.status === 'approved' && a.console_url) setMentorActive(true);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const confirm = async () => {
    if (leaving || mentorActive) return;
    setLeaving(true);
    setFailure(null);
    try {
      await api.eraseMe();
    } catch (e) {
      // Nothing leaves the device unless the server said "erased": the same session retries.
      if (e instanceof ApiError && e.code === 'mentor_active') setMentorActive(true);
      else setFailure(e instanceof ApiError && e.code === 'erase_incomplete' ? 'incomplete' : 'unreachable');
      setLeaving(false);
      return;
    }
    setCompanionColor(DEFAULT_COMPANION_COLOR); // un-tint before the new onboarding picks its own
    await unregisterPush();
    await clearSession();
    forgetPlacements(); // a new identity has no history of places
    await forgetAnalyticsId(); // …and no analytics trail back to the old one
    await clearListenerSession();
    await disconnectListenerClient().catch(() => {});
    router.dismissAll();
    router.replace('/');
  };

  const keep = () => {
    if (leaving) return;
    sheet.current?.close();
  };

  return (
    <BoardSheet
      controller={sheet}
      onDismiss={() => router.back()}
      dismissLabel={t('startFresh.closeA11y')}
      testID="start-fresh-modal"
      backdropTestID="start-fresh-backdrop"
    >
      <View style={styles.head}>
        <Text style={[type.sheetTitle, { color: colors.ink }]} accessibilityRole="header">
          {t('startFresh.titleLead')}
          <Text style={{ color: colors.accent }}>{t('startFresh.titleAccent')}</Text>
          {t('startFresh.titleTail')}
        </Text>
        <Text style={[type.bodySmall, { color: colors.ink }]}>{t('startFresh.sub')}</Text>
      </View>

      <EdgeSurface
        edge={colors.edgeSurface}
        travel={3}
        radius={radius.lg}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Text style={[styles.eyebrow, { color: colors.inkMuted }]}>{t('startFresh.listTitle')}</Text>
        {LEFT_BEHIND.map((row) => (
          <View key={row.lead} style={styles.row}>
            <View style={[styles.disc, { backgroundColor: colors.bgLavender }]}>
              <Ionicons name={row.icon} size={18} color={colors.ink} />
            </View>
            <Text style={[styles.rowText, { color: colors.inkMuted }]}>
              <Text style={[styles.rowLead, { color: colors.ink }]}>{t(row.lead)}</Text>{' '}
              {row.rest
                ? t(row.rest)
                : persona
                  ? t('startFresh.pathRest', { name: persona.persona_name })
                  : t('startFresh.pathRestNoName')}
            </Text>
          </View>
        ))}
        {/* reason: a one-sided dashed border does not draw on iOS / Android — a 1px box
            dashed all round does. */}
        <View style={[styles.rule, { borderColor: colors.handle }]} />
        <Text style={[type.note, { color: colors.ink }]} testID="start-fresh-truth">
          {t('startFresh.truth')}
        </Text>
        <Text style={[type.caption, { color: colors.inkMuted }]} testID="start-fresh-kept">
          {t('erase.kept')}
        </Text>
      </EdgeSurface>

      {/* Still, like every limit state: a line, never a shake. */}
      {mentorActive ? (
        <View style={[styles.warn, { backgroundColor: colors.surfaceAlt }]} testID="start-fresh-mentor">
          <Ionicons name="people-outline" size={20} color={colors.ink} />
          <Text style={[styles.warnText, { color: colors.ink }]}>{t('erase.mentorActive')}</Text>
        </View>
      ) : (
        <View style={[styles.warn, { backgroundColor: wash.danger }]}>
          <Ionicons name="alert-circle-outline" size={20} color={washInk.danger} />
          <Text style={[styles.warnText, { color: washInk.danger }]} testID="start-fresh-warn">
            {failure === 'incomplete' ? t('erase.failed') : failure === 'unreachable' ? t('erase.unreachable') : t('startFresh.warn')}
          </Text>
        </View>
      )}

      {/* Two keys of exactly the same size: leaving is never the easier tap. A live mentor
          keeps only "Keep my space" — the other key could only be refused. */}
      <View style={styles.keys}>
        {mentorActive ? null : (
        <PressKey
          onPress={() => void confirm()}
          disabled={leaving}
          edge={dangerKeyEdge}
          radius={radius.md}
          haptic="none"
          testID="start-fresh-confirm"
          style={[styles.key, { backgroundColor: washInk.danger }]}
        >
          {leaving ? (
            <ActivityIndicator color={colors.onBrand} />
          ) : (
            <Text style={[styles.keyText, { color: colors.onBrand }]} numberOfLines={1} adjustsFontSizeToFit>
              {failure ? t('erase.retry') : t('startFresh.confirm')}
            </Text>
          )}
        </PressKey>
        )}
        <PressKey
          onPress={keep}
          disabled={leaving}
          edge={colors.edgeSurface}
          radius={radius.md}
          testID="start-fresh-cancel"
          style={[styles.key, styles.keyPlain, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <Text style={[styles.keyText, { color: colors.ink }]} numberOfLines={1} adjustsFontSizeToFit>
            {t('startFresh.keep')}
          </Text>
        </PressKey>
      </View>
    </BoardSheet>
  );
}

const styles = StyleSheet.create({
  head: { gap: 4 },
  card: { paddingVertical: 12, paddingHorizontal: 14, gap: 8, borderWidth: 1 },
  eyebrow: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16, letterSpacing: 0.7, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  disc: { width: 32, height: 32, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0, fontFamily: font.sans, fontSize: 15, lineHeight: 20 },
  rowLead: { fontFamily: font.sansBold },
  rule: { height: 1, borderWidth: 1, borderStyle: 'dashed', borderRadius: 1 },
  warn: { paddingVertical: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: radius.md },
  warnText: { flex: 1, fontFamily: font.sansSemi, fontSize: 15, lineHeight: 22 },
  keys: { gap: 14, paddingTop: 2 },
  key: { height: 58, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  keyPlain: { borderWidth: 1 },
  keyText: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 24 },
});

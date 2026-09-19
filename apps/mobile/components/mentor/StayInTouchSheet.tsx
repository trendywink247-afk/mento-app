import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { MemberDisc } from '@/components/mentor/MemberDisc';
import { Entrance } from '@/components/motion/Entrance';
import { ApiError } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { listenerApi, type StayInTouchAsk } from '@/lib/listenerApi';
import { useTheme } from '@/theme/ThemeProvider';
import { space, type } from '@/theme/tokens';

type Result = 'yes' | 'no' | 'gone';

/** Board A15: a member asked to stay in touch. The sheet shows ONLY what the ask carries —
 * their persona and their companion in their colour — what saying yes means, and the two
 * answers. The result is a calm, still line; nothing celebrates, nothing is counted. */
export function StayInTouchSheet({
  ask,
  seats,
  onAnswered,
  onClose,
}: {
  ask: StayInTouchAsk;
  seats: number;
  /** Called once the server has the answer (the list refetches). */
  onAnswered: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [busy, setBusy] = useState<'yes' | 'no' | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState(false);
  const name = ask.member_persona_name;

  const answer = async (yes: boolean) => {
    if (busy) return;
    setBusy(yes ? 'yes' : 'no');
    setError(false);
    try {
      await (yes ? listenerApi.acceptStayInTouch(ask.id) : listenerApi.notNowStayInTouch(ask.id));
      setResult(yes ? 'yes' : 'no');
      onAnswered();
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setResult('gone');
        onAnswered();
      } else {
        setError(true);
      }
    } finally {
      setBusy(null);
    }
  };

  if (result) {
    const title = result === 'yes' ? t('mentorInTouch.yesTitle', { name }) : result === 'no' ? t('mentorInTouch.noTitle') : t('mentorInTouch.gone');
    return (
      <View style={styles.body} testID={`intouch-result-${result}`}>
        <IconBadge icon={result === 'yes' ? 'link-outline' : 'leaf-outline'} tone={result === 'yes' ? 'green' : 'orange'} size={44} />
        <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header" accessibilityLiveRegion="polite">
          {title}
        </Text>
        {result === 'gone' ? null : (
          <Text style={[type.body, { color: colors.ink }]}>
            {result === 'yes' ? t('mentorInTouch.yesBody') : t('mentorInTouch.noBody')}
          </Text>
        )}
        <PrimaryButton label={t('mentorInTouch.done')} shape="key" dense variant="surface" onPress={onClose} testID="intouch-done" />
      </View>
    );
  }

  return (
    <View style={styles.body} testID="intouch-sheet">
      <Entrance index={2} style={styles.head}>
        <View accessible accessibilityRole="image" accessibilityLabel={t('mentorInTouch.companionA11y', { name })}>
          <MemberDisc name={name} size={64} animal={ask.companion_animal} colour={ask.companion_colour} />
        </View>
        <Text style={[styles.title, styles.shrink, { color: colors.ink }]} accessibilityRole="header">
          {t('mentorInTouch.title', { name })}
          <Text style={{ color: colors.accent }}>{t('mentorInTouch.titleAccent')}</Text>
        </Text>
      </Entrance>

      <Entrance index={3}>
        <Text style={[type.body, { color: colors.ink }]}>{t('mentorInTouch.body')}</Text>
      </Entrance>

      <Entrance index={4} style={styles.points}>
        {[t('mentorInTouch.point1', { max: seats }), t('mentorInTouch.point2'), t('mentorInTouch.point3')].map((line) => (
          <View key={line} style={styles.point}>
            <Ionicons name="checkmark" size={18} color={colors.inkMuted} style={styles.tick} />
            <Text style={[type.note, styles.shrink, { color: colors.inkMuted }]}>{line}</Text>
          </View>
        ))}
      </Entrance>

      {error ? (
        <Text style={[type.note, { color: colors.ink }]} accessibilityLiveRegion="polite">
          {t('mentorInTouch.error')}
        </Text>
      ) : null}

      <Entrance index={5} style={styles.keys}>
        <View style={styles.notNow}>
          <PrimaryButton
            label={t('mentorInTouch.notNow')}
            shape="key"
            dense
            variant="surface"
            onPress={() => void answer(false)}
            loading={busy === 'no'}
            disabled={busy === 'yes'}
            testID="intouch-not-now"
          />
        </View>
        <View style={styles.yes}>
          <PrimaryButton
            label={t('mentorInTouch.yes')}
            shape="key"
            dense
            onPress={() => void answer(true)}
            loading={busy === 'yes'}
            disabled={busy === 'no'}
            testID="intouch-yes"
          />
        </View>
      </Entrance>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  title: { fontSize: 22, lineHeight: 28, fontFamily: type.displayHeadline.fontFamily },
  shrink: { flex: 1, minWidth: 0 },
  points: { gap: space.sm },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  tick: { marginTop: 1 },
  keys: { flexDirection: 'row', gap: 12 },
  notNow: { flex: 1 },
  yes: { flex: 1.4 },
});

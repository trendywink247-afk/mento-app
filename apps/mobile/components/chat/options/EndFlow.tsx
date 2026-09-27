import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Panda } from '@/components/art/Panda';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

import { FlowScreen, InfoRow } from './bits';

/** End and wipe (board A20's second End key) — the confirmation and its "All clean"
 * closure, with HONEST wipe copy (DECISIONS §H.2: messages are deleted from your device AND
 * our servers; we never claim device-only storage). Plain End no longer passes through
 * here: it is a key on the options sheet that goes straight to the reflection. */
export function EndFlow({
  conversationId,
  onBack,
  onEnded,
}: {
  conversationId: string;
  onBack: () => void;
  onEnded: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [step, setStep] = useState<'wipe-confirm' | 'all-clean'>('wipe-confirm');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  const doWipe = () =>
    run(async () => {
      await api.wipeConversation(conversationId);
      setStep('all-clean');
    });

  if (step === 'all-clean') {
    return (
      <FlowScreen
        title={t('options.end.wipeScreenTitle')}
        onBack={onEnded}
        footer={<PrimaryButton label={t('options.end.gotItBang')} onPress={onEnded} testID="opt-confirm" />}
      >
        <View style={styles.hero}>
          <Panda pose="excited" size={130} />
          <Text style={[styles.heroTitle, { color: colors.ink }]}>{t('options.end.allClean')}</Text>
          <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
            {t('options.end.allCleanBody')}
          </Text>
        </View>
        <InfoRow
          icon="lock-closed-outline"
          title={t('options.end.deletedTitle')}
          body={t('options.end.deletedBody')}
        />
      </FlowScreen>
    );
  }

  return (
      <FlowScreen
        title={t('options.end.wipeTitle')}
        onBack={onBack}
        footer={
          <>
            {error ? (
              <Text style={[type.caption, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
            ) : null}
            <PrimaryButton label={t('options.end.wipeCta')} onPress={() => void doWipe()} loading={busy} testID="opt-confirm" />
            <PrimaryButton label={t('common.cancel')} variant="link" onPress={onBack} testID="opt-cancel" />
          </>
        }
      >
        <View style={styles.hero}>
          <Panda pose="wave" size={120} />
          <Text style={[styles.heroTitle, { color: colors.ink }]}>{t('options.end.wipeTitle')}</Text>
          <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
            {t('options.end.confirmBody')}
          </Text>
        </View>
        <View style={[styles.infoCard, { backgroundColor: colors.surfaceAlt }]}>
          <InfoRowPlain icon="chatbubble-outline" text={t('options.end.info1')} />
          <InfoRowPlain icon="alert-circle-outline" text={t('options.end.info2')} />
          <InfoRowPlain
            icon="shield-checkmark-outline"
            text={t('options.end.info3')}
          />
        </View>
      </FlowScreen>
  );
}

function InfoRowPlain({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.plainRow}>
      <IconBadge icon={icon} size={34} />
      <Text style={[type.caption, { color: colors.ink, flex: 1 }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.xs, marginBottom: space.sm },
  heroTitle: { fontFamily: font.serifBold, fontSize: 27, lineHeight: 34, marginTop: space.xs },
  infoCard: { borderRadius: radius.lg, padding: space.sm, gap: space.sm },
  plainRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});

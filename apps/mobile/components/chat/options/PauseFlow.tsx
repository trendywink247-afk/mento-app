import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Panda } from '@/components/art/Panda';
import { ApiError, api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

import { ConfirmModal, FlowScreen, InfoRow, LockFootnote } from './bits';

/** Panda Pause per mockup #25: info rows + toggle + confirm modal. */
export function PauseFlow({
  conversationId,
  paused,
  onBack,
  onChanged,
}: {
  conversationId: string;
  paused: boolean;
  onBack: () => void;
  onChanged: (paused: boolean) => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [next, setNext] = useState(!paused); // the state the user is about to apply
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const apply = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.setPause(conversationId, next);
      onChanged(s.is_paused);
      if (s.is_paused) setDone(true);
      else onBack();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlowScreen
      title={t('options.pause.title')}
      subtitle={t('options.pause.subtitle')}
      icon="notifications-off-outline"
      onBack={onBack}
      footer={
        <>
          {error ? (
            <Text style={[type.caption, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
          ) : null}
          <PrimaryButton
            label={next ? t('options.pause.ctaOn') : t('options.pause.ctaResume')}
            onPress={() => void apply()}
            loading={busy}
            testID="opt-confirm"
          />
          <LockFootnote text={t('options.onlyThisConversation')} />
        </>
      }
    >
      <View style={[styles.hero, { backgroundColor: colors.surface }]}>
        <Panda pose="sleep" size={120} />
        <Text style={[styles.heroTitle, { color: colors.ink }]}>
          {t('options.pause.heroTitle')}
        </Text>
        <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
          {t('options.pause.heroBody')}
        </Text>
      </View>

      <InfoRow
        icon="chatbubble-ellipses-outline"
        title={t('options.pause.info1Title')}
        body={t('options.pause.info1Body')}
      />
      <InfoRow
        icon="notifications-off-outline"
        tone="orange"
        title={t('options.pause.info2Title')}
        body={t('options.pause.info2Body')}
      />

      <View style={[styles.toggleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: colors.ink }]}>{t('options.pause.toggleTitle')}</Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>
            {t('options.pause.toggleBody')}
          </Text>
        </View>
        <Switch
          value={next}
          onValueChange={setNext}
          trackColor={{ true: colors.accent, false: colors.border }}
          thumbColor={colors.surface}
          accessibilityLabel={t('options.pause.toggleTitle')}
          testID="pause-toggle"
        />
      </View>

      <View style={[styles.note, { backgroundColor: colors.surfaceAlt }]}>
        <Panda pose="shield" size={56} />
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: colors.ink }]}>{t('options.pause.lostTitle')}</Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>
            {t('options.pause.lostBody')}
          </Text>
        </View>
      </View>

      <ConfirmModal
        visible={done}
        art={<Panda pose="sleep" size={110} />}
        title={t('options.pause.doneTitle')}
        body={t('options.pause.doneBody')}
        rows={[
          { icon: 'notifications-off-outline', tone: 'orange', title: t('options.pause.row1Title'), body: t('options.pause.row1Body') },
          { icon: 'file-tray-outline', title: t('options.pause.row2Title'), body: t('options.pause.row2Body') },
        ]}
        cta={t('common.gotIt')}
        onDone={onBack}
      />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.xs, borderRadius: radius.lg, padding: space.md },
  heroTitle: {
    fontFamily: font.serifBold,
    fontSize: 24,
    lineHeight: 31,
    textAlign: 'center',
    marginTop: space.xs,
  },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.md,
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.sm,
  },
});

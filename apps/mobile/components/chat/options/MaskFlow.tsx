import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Panda } from '@/components/art/Panda';
import { ApiError, api } from '@/lib/api';
import { useI18n, type TKey } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, type Wash } from '@/theme/tokens';

import { ConfirmModal, FlowScreen, LockFootnote, RadioRow } from './bits';

/** Panda Mask presets per mockup #21 — replaces the old free-text mask client-side
 * (the backend stores the chosen string unchanged). `label` is the canonical value
 * sent to the API (and the testID seed) — it stays English in every locale; only
 * the displayed title/body translate. */
const STATUSES: { label: string; titleKey: TKey; bodyKey: TKey; icon: keyof typeof Ionicons.glyphMap; tone: Wash }[] = [
  { label: 'Available', titleKey: 'options.mask.availableTitle', bodyKey: 'options.mask.availableBody', icon: 'ellipse', tone: 'green' },
  { label: 'Away', titleKey: 'options.mask.awayTitle', bodyKey: 'options.mask.awayBody', icon: 'moon-outline', tone: 'indigo' },
  { label: 'Taking Time for Myself', titleKey: 'options.mask.selfCareTitle', bodyKey: 'options.mask.selfCareBody', icon: 'leaf-outline', tone: 'green' },
  { label: 'Focusing', titleKey: 'options.mask.focusingTitle', bodyKey: 'options.mask.focusingBody', icon: 'book-outline', tone: 'accent' },
  { label: 'Be Right Back', titleKey: 'options.mask.brbTitle', bodyKey: 'options.mask.brbBody', icon: 'cafe-outline', tone: 'orange' },
  { label: 'Invisible', titleKey: 'options.mask.invisibleTitle', bodyKey: 'options.mask.invisibleBody', icon: 'eye-off-outline', tone: 'indigo' },
];

export function MaskFlow({
  conversationId,
  current,
  onBack,
  onChanged,
}: {
  conversationId: string;
  current: string | null;
  onBack: () => void;
  onChanged: (mask: string | null) => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [choice, setChoice] = useState<string | null>(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const apply = async () => {
    if (!choice || busy) return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.setStatusMask(conversationId, choice);
      onChanged(s.status_mask);
      setDone(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.somethingWrong'));
    } finally {
      setBusy(false);
    }
  };

  const chosen = STATUSES.find((s) => s.label === choice);

  return (
    <FlowScreen
      title={t('options.mask.title')}
      subtitle={t('options.mask.subtitle')}
      icon="glasses-outline"
      onBack={onBack}
      footer={
        <>
          {error ? (
            <Text style={[type.caption, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
          ) : null}
          <PrimaryButton
            label={t('options.mask.apply')}
            onPress={() => void apply()}
            disabled={!choice}
            loading={busy}
            testID="opt-confirm"
          />
          <LockFootnote text={t('options.onlyThisConversation')} />
        </>
      }
    >
      <View style={[styles.hero, { backgroundColor: colors.surface }]}>
        <Panda pose="shield" size={110} />
        <Text style={[styles.heroTitle, { color: colors.ink }]}>{t('options.mask.title')}</Text>
        <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
          {t('options.mask.heroBody')}
        </Text>
      </View>

      <View style={[styles.note, { backgroundColor: colors.surfaceAlt }]}>
        <IconBadge icon="shield-outline" size={34} />
        <Text style={[type.caption, { color: colors.ink, flex: 1 }]}>
          {t('options.mask.note')}
        </Text>
      </View>

      <Text style={[styles.section, { color: colors.ink }]}>
        {t('options.mask.section')}
      </Text>
      {STATUSES.map((s) => (
        <RadioRow
          key={s.label}
          icon={s.icon}
          tone={s.tone}
          title={t(s.titleKey)}
          body={t(s.bodyKey)}
          selected={choice === s.label}
          onPress={() => setChoice(s.label)}
          testID={`mask-${s.label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
        />
      ))}

      <View style={[styles.note, { backgroundColor: colors.surfaceAlt }]}>
        <Panda pose="shield" size={56} />
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: colors.ink }]}>{t('options.mask.privateTitle')}</Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>
            {t('options.mask.privateBody')}
          </Text>
        </View>
      </View>

      <ConfirmModal
        visible={done}
        art={<Panda pose="excited" size={110} />}
        title={t('options.mask.doneTitle')}
        body={t('options.mask.doneBody', { status: chosen ? t(chosen.titleKey) : (choice ?? '') })}
        cta={t('common.gotIt')}
        onDone={onBack}
      />
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.xs, borderRadius: radius.lg, padding: space.md },
  heroTitle: { fontFamily: font.serifBold, fontSize: 26, lineHeight: 32, marginTop: space.xs },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.sm,
  },
  section: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 22, marginTop: space.sm },
});

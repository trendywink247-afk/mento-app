import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Panda } from '@/components/art/Panda';
import { ApiError, api } from '@/lib/api';
import { useI18n, type TKey } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, type Wash } from '@/theme/tokens';

import { FlowScreen, LockFootnote, RadioRow } from './bits';

/** Report/Block per mockup: choose Report&Block vs Just Block, then 7 reason radios.
 * The chosen reason string becomes the moderation-event reason (backend unchanged;
 * both paths end the chat, block prevents re-match — server-enforced). `label` is
 * the canonical reason sent to the API — it stays English in every locale so the
 * moderation queue reads consistently; only the displayed text translates. */
const REASONS: { label: string; key: TKey; icon: keyof typeof Ionicons.glyphMap; tone: Wash }[] = [
  { label: 'Aggressive', key: 'options.report.reason1', icon: 'sad-outline', tone: 'danger' },
  { label: 'Sexual Conversation', key: 'options.report.reason2', icon: 'chatbubble-outline', tone: 'danger' },
  { label: 'Asking for money', key: 'options.report.reason3', icon: 'cash-outline', tone: 'orange' },
  { label: 'Asking for personal details', key: 'options.report.reason4', icon: 'person-outline', tone: 'indigo' },
  { label: 'Made me uncomfortable', key: 'options.report.reason5', icon: 'alert-circle-outline', tone: 'danger' },
  { label: "It's not their mistake, I'm just not comfortable", key: 'options.report.reason6', icon: 'heart-dislike-outline', tone: 'accent' },
  { label: 'Any other', key: 'options.report.reason7', icon: 'ellipsis-horizontal', tone: 'indigo' },
];

export function ReportFlow({
  conversationId,
  onBack,
  onDone,
}: {
  conversationId: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [kind, setKind] = useState<'report' | 'block' | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!kind || !reason || busy) return;
    setBusy(true);
    setError(null);
    try {
      // "Report & Block" files the report AND blocks; "Just Block" only blocks.
      if (kind === 'report') await api.reportConversation(conversationId, reason);
      await api.blockConversation(conversationId, reason);
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('common.somethingWrong'));
      setBusy(false);
    }
  };

  if (!kind) {
    return (
      <FlowScreen
        title={t('options.report.title')}
        onBack={onBack}
        footer={<PrimaryButton label={t('common.cancel')} variant="ghost" onPress={onBack} testID="opt-cancel" />}
      >
        <View style={styles.hero}>
          <Panda pose="shield" size={130} />
          <Text style={[styles.heroTitle, { color: colors.ink }]}>{t('options.report.heroTitle')}</Text>
          <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
            {t('options.report.heroBody')}
          </Text>
        </View>

        <Pressable
          onPress={() => setKind('report')}
          accessibilityRole="button"
          testID="report-and-block"
          style={[styles.choice, { backgroundColor: colors.surface }]}
        >
          <IconBadge icon="flag-outline" size={48} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: colors.ink }]}>{t('options.report.reportBlock')}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              {t('options.report.reportBlockBody')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
        </Pressable>

        <Pressable
          onPress={() => setKind('block')}
          accessibilityRole="button"
          testID="just-block"
          style={[styles.choice, { backgroundColor: colors.surface }]}
        >
          <IconBadge icon="ban-outline" tone="indigo" size={48} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: colors.ink }]}>{t('options.report.justBlock')}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              {t('options.report.justBlockBody')}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
        </Pressable>
      </FlowScreen>
    );
  }

  return (
    <FlowScreen
      title={kind === 'report' ? t('options.report.reportBlock') : t('options.report.justBlock')}
      onBack={() => setKind(null)}
      footer={
        <>
          {error ? (
            <Text style={[type.caption, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
          ) : null}
          <PrimaryButton
            label={kind === 'report' ? t('options.report.submitBlock') : t('options.report.blockCta')}
            icon="shield-outline"
            onPress={() => void submit()}
            disabled={!reason}
            loading={busy}
            testID="opt-confirm"
          />
          <LockFootnote text={t('options.report.footnote')} />
        </>
      }
    >
      <View style={styles.hero}>
        <Panda pose="shield" size={110} />
        <Text style={[styles.heroTitle, { color: colors.ink }]}>
          {t('options.report.whyTitle')}
        </Text>
        <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
          {t('options.report.whyBody')}
        </Text>
      </View>

      {REASONS.map((r, i) => (
        <RadioRow
          key={r.label}
          icon={r.icon}
          tone={r.tone}
          title={`${i + 1}. ${t(r.key)}`}
          selected={reason === r.label}
          onPress={() => setReason(r.label)}
          testID={`reason-${i + 1}`}
        />
      ))}

      <View style={[styles.note, { backgroundColor: colors.surfaceAlt }]}>
        <IconBadge icon="shield-outline" size={34} />
        <Text style={[type.caption, { color: colors.ink, flex: 1 }]}>
          {t('options.report.note')}
        </Text>
      </View>
    </FlowScreen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.xs, marginBottom: space.sm },
  heroTitle: {
    fontFamily: font.serifBold,
    fontSize: 25,
    lineHeight: 32,
    textAlign: 'center',
    marginTop: space.xs,
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
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

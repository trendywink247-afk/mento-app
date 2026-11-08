import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { KeyboardAvoidingView } from '@/components/KeyboardAvoidingView';
import { PrimaryButton } from '@/components/PrimaryButton';
import { MentorPageHeader } from '@/components/mentor/MentorPageHeader';
import { api, ApiError, type ListenerApplication } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { radius, space, type } from '@/theme/tokens';

/**
 * "I have an invitation" (DECISIONS §P.2-3): the founder hands a vetted person a one-time code.
 * Claiming it makes this anonymous account a certified (gold) mentor with no application. The
 * member recovery code is what brings the role back on a new phone, so this says so.
 */
export function InviteStep({
  onBack,
  onClaimed,
}: {
  onBack: () => void;
  onClaimed: (application: ListenerApplication) => void;
}) {
  const { colors } = useTheme();
  const { t } = useI18n();
  const [code, setCode] = useState('');
  const [pledged, setPledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ready = code.replace(/[\s-]/g, '').length >= 16 && pledged;

  const claim = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      onClaimed(await api.claimMentorInvite(code.trim(), pledged));
    } catch (e) {
      // 404 = wrong, used, expired or revoked (the server says the same for all four).
      setProblem(
        e instanceof ApiError && e.status === 404
          ? t('mentorInvite.notWorking')
          : e instanceof ApiError && e.status === 409
            ? t('mentorInvite.alreadyOnFile')
            : t('mentorInvite.tryAgain'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.fill}>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <MentorPageHeader eyebrow={t('mentorInvite.eyebrow')} title={t('mentorInvite.title')} onBack={onBack} />
        <Text style={[type.body, { color: colors.inkMuted }]}>{t('mentorInvite.intro')}</Text>
        <TextInput
          value={code}
          onChangeText={(v) => {
            setCode(v);
            setProblem(null);
          }}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={24}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          placeholderTextColor={colors.inkMuted}
          accessibilityLabel={t('mentorInvite.codeLabel')}
          style={[styles.field, { backgroundColor: colors.surface, borderColor: colors.border, color: colors.ink }]}
          testID="invite-code"
        />
        <Pressable
          onPress={() => setPledged((p) => !p)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: pledged }}
          style={styles.pledge}
          testID="invite-pledge"
        >
          <View style={[styles.box, { borderColor: pledged ? colors.accent : colors.border, backgroundColor: pledged ? colors.accent : colors.surface }]}>
            {pledged ? <Ionicons name="checkmark" size={16} color={colors.onAccent} /> : null}
          </View>
          <Text style={[type.body, styles.shrink, { color: colors.ink }]}>{t('mentorApply.pledge')}</Text>
        </Pressable>
        {problem ? (
          <Text style={[type.caption, { color: colors.danger }]} accessibilityLiveRegion="polite" testID="invite-problem">
            {problem}
          </Text>
        ) : null}
        <PrimaryButton label={t('mentorInvite.claim')} shape="key" onPress={() => void claim()} disabled={!ready} loading={busy} testID="invite-claim" />
        <Text style={[type.caption, { color: colors.inkMuted }]}>{t('mentorInvite.recoveryNote')}</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.lg, gap: 14 },
  field: { height: 52, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16, letterSpacing: 1 },
  pledge: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  box: { width: 26, height: 26, borderRadius: 7, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  shrink: { flex: 1, minWidth: 0 },
});

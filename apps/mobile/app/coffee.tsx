import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BackKey } from '@/components/DeepHeader';
import { EdgeSurface } from '@/components/EdgeSurface';
import { IconBadge } from '@/components/IconBadge';
import { CompanionPerches, CompanionSlot, useCompanionPlacement } from '@/components/art/PerchedCompanion';
import { DeepArrival } from '@/components/motion/DeepArrival';
import { Entrance } from '@/components/motion/Entrance';
import { PressKey } from '@/components/motion/PressKey';
import type { PlacementSlot } from '@/lib/companionPlacement';
import { useI18n, type TKey } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, type Wash } from '@/theme/tokens';

const AMOUNTS = [49, 99, 199] as const;
type Choice = (typeof AMOUNTS)[number] | 'other';

const PAYS_FOR: { icon: keyof typeof Ionicons.glyphMap; tone: Wash; title: TKey; body: TKey }[] = [
  { icon: 'server-outline', tone: 'sky', title: 'support.servers', body: 'support.serversBody' },
  { icon: 'shield-outline', tone: 'indigo', title: 'support.safety', body: 'support.safetyBody' },
  { icon: 'lock-open-outline', tone: 'green', title: 'support.free', body: 'support.freeBody' },
];

const PERCHES: PlacementSlot[] = [{ id: 'noteTop', type: 'top', level: 'high', home: true }];

/**
 * Support the team (board A31). Honest-money rules (T&S #4): opt-in, one time, supports the
 * TEAM, never inside a live conversation, never framed as membership, no tiers and no perks,
 * never a "reward" for a reflection (DECISIONS §A.3). "Nothing in Mento is locked."
 *
 * Payments are NOT live (no Razorpay credentials yet). The page says so before the tap —
 * the line under the key — and again, still, after it: nothing is charged and nothing
 * pretends to be. The board's thank-you state arrives with the real checkout.
 */
export default function CoffeeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const [choice, setChoice] = useState<Choice>(99);
  const [custom, setCustom] = useState('');
  const [told, setTold] = useState(false);
  // The not-live note is a limit state: the companion sits still.
  const perch = useCompanionPlacement('coffee', PERCHES, { still: told });

  const pick = (c: Choice) => {
    setChoice(c);
    setTold(false);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <CompanionPerches placement={perch}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.page}
        >
          <View style={styles.header}>
            <BackKey onPress={() => router.back()} label={t('support.backA11y')} />
            <Text style={[styles.headerLabel, { color: colors.ink }]}>{t('profile.title')}</Text>
          </View>

          <DeepArrival style={styles.column}>
            <Entrance index={1}>
              <Text style={[type.displayHeadline, styles.title, { color: colors.ink }]} accessibilityRole="header">
                {t('support.titleLead')}
                <Text style={{ color: colors.accent }}>{t('support.titleAccent')}</Text>
                {t('support.titleTail')}
              </Text>
            </Entrance>

            <View style={styles.furniture}>
              <CompanionSlot id="noteTop" size={60} inset={22} />
              <Entrance index={2}>
                <EdgeSurface
                  edge={colors.edgeSurface}
                  travel={3}
                  radius={radius.lg}
                  style={[styles.noteCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <Text style={[styles.eyebrow, { color: colors.inkMuted }]}>{t('support.noteEyebrow')}</Text>
                  <Text style={[type.body, { color: colors.ink }]}>{t('support.noteBody')}</Text>
                  <Text style={[type.caption, { color: colors.inkMuted }]}>{t('support.noteSmall')}</Text>
                </EdgeSurface>
              </Entrance>
            </View>

            <Entrance index={3} style={styles.amountBlock}>
              <Text style={[type.label, styles.amountHead, { color: colors.ink }]}>
                {t('support.amountTitle')}
                <Text style={[type.note, { color: colors.inkMuted }]}>{`  ${t('support.amountHint')}`}</Text>
              </Text>
              <View style={styles.amounts} accessibilityLabel={t('support.amountTitle')}>
                {([...AMOUNTS, 'other'] as Choice[]).map((c) => {
                  const on = choice === c;
                  return (
                    <PressKey
                      key={String(c)}
                      onPress={() => pick(c)}
                      edge={on ? colors.accentEdge : colors.edgeSurface}
                      radius={radius.md}
                      intent="select"
                      accessibilityState={{ selected: on }}
                      testID={c === 'other' ? 'amount-custom' : `amount-${c}`}
                      containerStyle={styles.amountBox}
                      style={[
                        styles.amountKey,
                        on
                          ? { backgroundColor: colors.accent, borderColor: colors.accent }
                          : { backgroundColor: colors.surface, borderColor: colors.border },
                      ]}
                    >
                      <Text
                        style={[c === 'other' ? type.keyDense : type.key, { color: on ? colors.onAccent : colors.ink }]}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                      >
                        {c === 'other' ? t('support.other') : `₹${c}`}
                      </Text>
                    </PressKey>
                  );
                })}
              </View>
              {choice === 'other' ? (
                <EdgeSurface
                  edge={colors.edgeSurface}
                  travel={3}
                  radius={radius.md}
                  style={[styles.otherRow, { backgroundColor: colors.surface, borderColor: colors.border }]}
                >
                  <Text style={[type.label, { color: colors.inkMuted }]}>{t('support.yourAmount')}</Text>
                  <Text style={[type.key, { color: colors.ink }]}>₹</Text>
                  <TextInput
                    style={[styles.otherInput, { color: colors.ink }]}
                    placeholder={t('support.anyAmount')}
                    placeholderTextColor={colors.inkMuted}
                    keyboardType="number-pad"
                    value={custom}
                    onChangeText={(v) => setCustom(v.replace(/[^0-9]/g, ''))}
                    maxLength={6}
                    accessibilityLabel={t('support.otherA11y')}
                    testID="custom-amount"
                  />
                </EdgeSurface>
              ) : null}
            </Entrance>

            <Entrance index={4}>
              <View
                style={[styles.pays, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
                accessibilityLabel={t('support.paysTitle')}
              >
                <Text style={[styles.eyebrow, { color: colors.inkMuted }]}>{t('support.paysTitle')}</Text>
                {PAYS_FOR.map((p) => (
                  <View key={p.title} style={styles.paysRow}>
                    <IconBadge icon={p.icon} tone={p.tone} size={36} />
                    <View style={styles.paysText}>
                      <Text style={[type.rowTitle, { color: colors.ink }]}>{t(p.title)}</Text>
                      <Text style={[type.caption, { color: colors.inkMuted }]}>{t(p.body)}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </Entrance>

            <View style={styles.spacer} />

            <Entrance index={5} style={styles.foot}>
              {told ? (
                // Still on purpose (T&S #11): a limit state — no arrival, no haptic, no colour alarm.
                <View style={[styles.told, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} testID="payments-note">
                  <Ionicons name="time-outline" size={20} color={colors.ink} />
                  <Text style={[type.note, styles.toldText, { color: colors.ink }]}>{t('support.notLiveNote')}</Text>
                </View>
              ) : null}
              <PressKey
                onPress={() => setTold(true)}
                edge={colors.accentEdge}
                radius={radius.md}
                haptic="none"
                accessibilityHint={t('support.notLive')}
                testID="coffee-contribute"
                style={[styles.give, { backgroundColor: colors.accent }]}
              >
                <Ionicons name="cafe-outline" size={20} color={colors.onAccent} />
                <Text style={[type.key, { color: colors.onAccent }]} numberOfLines={1} adjustsFontSizeToFit>
                  {choice === 'other'
                    ? t('support.contributeOther')
                    : t('support.contribute', { amount: choice })}
                </Text>
              </PressKey>
              <Text style={[type.caption, styles.centre, { color: colors.ink }]} testID="payments-not-live">
                {t('support.notLive')}
              </Text>
              <Text style={[type.caption, styles.centre, { color: colors.inkMuted }]}>{t('support.locked')}</Text>
            </Entrance>
          </DeepArrival>
        </ScrollView>
      </CompanionPerches>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  page: { flexGrow: 1, paddingTop: space.xs, paddingHorizontal: space.lg, paddingBottom: space.lg, gap: 12 },
  header: { height: 48, flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerLabel: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 24 },
  column: { flexGrow: 1, gap: 14 },
  title: { lineHeight: 36 },
  furniture: { zIndex: 1 },
  noteCard: { paddingVertical: 14, paddingHorizontal: space.md, gap: 6, borderWidth: 1 },
  eyebrow: { fontFamily: font.sansBold, fontSize: 12, lineHeight: 16, letterSpacing: 0.7, textTransform: 'uppercase' },
  amountBlock: { gap: space.sm },
  amountHead: { paddingHorizontal: space.xs },
  amounts: { flexDirection: 'row', gap: space.sm },
  amountBox: { flex: 1 },
  amountKey: { height: 56, paddingHorizontal: 2, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  otherRow: { height: 52, paddingHorizontal: space.md, flexDirection: 'row', alignItems: 'center', gap: space.sm, borderWidth: 1 },
  otherInput: { flex: 1, minWidth: 0, height: 44, ...type.key },
  pays: { paddingVertical: 10, paddingHorizontal: 14, gap: space.sm, borderRadius: radius.lg, borderWidth: 1 },
  paysRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  paysText: { flex: 1, minWidth: 0 },
  spacer: { flexGrow: 1, minHeight: 0 },
  foot: { gap: 12 },
  told: { padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: radius.md, borderWidth: 1 },
  toldText: { flex: 1 },
  give: { height: 58, paddingHorizontal: space.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  centre: { textAlign: 'center' },
});

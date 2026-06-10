import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Panda } from '@/components/art/Panda';
import { ApiError, api } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

import { FlowScreen, InfoRow } from './bits';

/** End vs Panda Wipe per mockup #26 — two-step, with HONEST wipe copy (DECISIONS
 * §H.2: messages are deleted from your device AND our servers; we never claim
 * device-only storage). End → the reflection screen; Wipe → "All clean!". */
export function EndFlow({
  conversationId,
  onBack,
  onEnded,
}: {
  conversationId: string;
  onBack: () => void;
  onEnded: (how: 'end' | 'wipe') => void;
}) {
  const { colors } = useTheme();
  const [step, setStep] = useState<'choose' | 'wipe-confirm' | 'all-clean'>('choose');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const doEnd = () =>
    run(async () => {
      await api.endConversation(conversationId);
      onEnded('end');
    });

  const doWipe = () =>
    run(async () => {
      await api.wipeConversation(conversationId);
      setStep('all-clean');
    });

  if (step === 'all-clean') {
    return (
      <FlowScreen
        title="Panda Wipe"
        onBack={() => onEnded('wipe')}
        footer={<PrimaryButton label="Got it!" onPress={() => onEnded('wipe')} testID="opt-confirm" />}
      >
        <View style={styles.hero}>
          <Panda pose="excited" size={130} />
          <Text style={[styles.heroTitle, { color: colors.ink }]}>All clean! 🍃</Text>
          <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
            The conversation has been deleted from both accounts.
          </Text>
        </View>
        <InfoRow
          icon="lock-closed-outline"
          title="Deleted everywhere"
          body="Messages were removed from your device and from our servers. You're always in control of your conversations."
        />
      </FlowScreen>
    );
  }

  if (step === 'wipe-confirm') {
    return (
      <FlowScreen
        title="Panda Wipe!!"
        onBack={() => setStep('choose')}
        footer={
          <>
            {error ? (
              <Text style={[type.caption, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
            ) : null}
            <PrimaryButton label="Yes, wipe it clean!" onPress={() => void doWipe()} loading={busy} testID="opt-confirm" />
            <PrimaryButton label="Cancel" variant="link" onPress={() => setStep('choose')} testID="opt-cancel" />
          </>
        }
      >
        <View style={styles.hero}>
          <Panda pose="wave" size={120} />
          <Text style={[styles.heroTitle, { color: colors.ink }]}>Panda Wipe!!</Text>
          <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
            Are you sure you want to delete this conversation?
          </Text>
        </View>
        <View style={[styles.infoCard, { backgroundColor: colors.surfaceAlt }]}>
          <InfoRowPlain icon="chatbubble-outline" text="All messages in this conversation will be deleted." />
          <InfoRowPlain icon="alert-circle-outline" text="This action cannot be undone." />
          <InfoRowPlain
            icon="shield-checkmark-outline"
            text="Messages will be deleted from your device and from our servers — both your account and your mentor's."
          />
        </View>
      </FlowScreen>
    );
  }

  return (
    <FlowScreen
      title="End Conversation"
      onBack={onBack}
      footer={
        <>
          {error ? (
            <Text style={[type.caption, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
          ) : null}
          <PrimaryButton label="Cancel" variant="ghost" onPress={onBack} testID="opt-cancel" />
        </>
      }
    >
      <View style={styles.hero}>
        <Panda pose="wave" size={130} />
        <Text style={[styles.heroTitle, { color: colors.ink }]}>End Conversation?</Text>
        <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
          You can close this conversation anytime. This will end the chat, but it won't delete
          any messages.
        </Text>
      </View>

      <View style={[styles.choiceCard, { backgroundColor: colors.surface }]}>
        <Pressable
          onPress={() => void doEnd()}
          accessibilityRole="button"
          accessibilityLabel="End conversation"
          testID="end-only"
          style={styles.choiceRow}
        >
          <IconBadge icon="chatbubble-ellipses-outline" size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: colors.ink }]}>End Conversation</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              Close the chat. Your messages stay until you wipe them.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
        </Pressable>
        <View style={[styles.divider, { backgroundColor: colors.border }]} />
        <Pressable
          onPress={() => setStep('wipe-confirm')}
          accessibilityRole="button"
          accessibilityLabel="Panda Wipe — delete all messages"
          testID="wipe-choice"
          style={styles.choiceRow}
        >
          <IconBadge icon="trash-outline" tone="danger" size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: colors.ink }]}>Panda Wipe!!</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              Delete all messages from this conversation for both you and your mentor.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
        </Pressable>
      </View>

      <View style={[styles.privacyCard, { backgroundColor: colors.surfaceAlt }]}>
        <IconBadge icon="shield-checkmark-outline" size={36} />
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: colors.ink }]}>We value your privacy</Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>
            Ending a chat keeps your messages. Panda Wipe deletes them from your device and from
            our servers — both sides, permanently.
          </Text>
        </View>
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
  choiceCard: { borderRadius: radius.lg, padding: space.xs },
  choiceRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm },
  divider: { height: 1, marginHorizontal: space.sm },
  privacyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.sm,
  },
  infoCard: { borderRadius: radius.lg, padding: space.sm, gap: space.sm },
  plainRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});

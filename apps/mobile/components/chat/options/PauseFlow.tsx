import { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { Panda } from '@/components/art/Panda';
import { ApiError, api } from '@/lib/api';
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
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlowScreen
      title="Panda Pause"
      subtitle="Take a break from this conversation"
      icon="notifications-off-outline"
      onBack={onBack}
      footer={
        <>
          {error ? (
            <Text style={[type.caption, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
          ) : null}
          <PrimaryButton
            label={next ? 'Turn on Panda Pause' : 'Resume notifications'}
            onPress={() => void apply()}
            loading={busy}
            testID="opt-confirm"
          />
          <LockFootnote text="This setting is only for this conversation and won't affect others." />
        </>
      }
    >
      <View style={[styles.hero, { backgroundColor: colors.surface }]}>
        <Panda pose="sleep" size={120} />
        <Text style={[styles.heroTitle, { color: colors.ink }]}>
          Need a little{'\n'}breathing room?
        </Text>
        <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
          Turn on Panda Pause and we'll quietly hold any new messages from this mentor until
          you're ready to return.
        </Text>
      </View>

      <InfoRow
        icon="chatbubble-ellipses-outline"
        title="Your mentor can still write to you."
        body="They can send messages as usual."
      />
      <InfoRow
        icon="notifications-off-outline"
        tone="orange"
        title="You simply won't be notified."
        body="No alerts, no sounds, no distractions."
      />

      <View style={[styles.toggleCard, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: colors.ink }]}>Pause this conversation</Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>
            You won't receive any messages until you resume.
          </Text>
        </View>
        <Switch
          value={next}
          onValueChange={setNext}
          trackColor={{ true: colors.accent, false: colors.border }}
          thumbColor={colors.surface}
          accessibilityLabel="Pause this conversation"
          testID="pause-toggle"
        />
      </View>

      <View style={[styles.note, { backgroundColor: colors.surfaceAlt }]}>
        <Panda pose="shield" size={56} />
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: colors.ink }]}>Nothing will be lost.</Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>
            We'll keep every message safe until you come back. 💜
          </Text>
        </View>
      </View>

      <ConfirmModal
        visible={done}
        art={<Panda pose="sleep" size={110} />}
        title="Panda Pause is on."
        body="Take all the time you need. We'll quietly hold new messages from this mentor until you're ready to continue."
        rows={[
          { icon: 'notifications-off-outline', tone: 'orange', title: 'Notifications paused', body: "You won't get any alerts." },
          { icon: 'file-tray-outline', title: 'Messages safely stored', body: "We'll keep everything secure until you return." },
        ]}
        cta="Got it"
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

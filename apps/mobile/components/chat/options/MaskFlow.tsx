import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Panda } from '@/components/art/Panda';
import { ApiError, api } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, type Wash } from '@/theme/tokens';

import { ConfirmModal, FlowScreen, LockFootnote, RadioRow } from './bits';

/** Panda Mask presets per mockup #21 — replaces the old free-text mask client-side
 * (the backend stores the chosen string unchanged). */
const STATUSES: { label: string; body: string; icon: keyof typeof Ionicons.glyphMap; tone: Wash }[] = [
  { label: 'Available', body: "I'm available to chat", icon: 'ellipse', tone: 'green' },
  { label: 'Away', body: "I'll reply when I can", icon: 'moon-outline', tone: 'indigo' },
  { label: 'Taking Time for Myself', body: "I'm focusing on self-care", icon: 'leaf-outline', tone: 'green' },
  { label: 'Focusing', body: "I'm working on something important", icon: 'book-outline', tone: 'accent' },
  { label: 'Be Right Back', body: "I'll be back shortly", icon: 'cafe-outline', tone: 'orange' },
  { label: 'Invisible', body: 'Hide my presence in this chat', icon: 'eye-off-outline', tone: 'indigo' },
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
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlowScreen
      title="Panda Mask"
      subtitle="Status for this conversation"
      icon="glasses-outline"
      onBack={onBack}
      footer={
        <>
          {error ? (
            <Text style={[type.caption, { color: colors.danger, textAlign: 'center' }]}>{error}</Text>
          ) : null}
          <PrimaryButton
            label="Apply Mask"
            onPress={() => void apply()}
            disabled={!choice}
            loading={busy}
            testID="opt-confirm"
          />
          <LockFootnote text="This setting is only for this conversation and won't affect others." />
        </>
      }
    >
      <View style={[styles.hero, { backgroundColor: colors.surface }]}>
        <Panda pose="shield" size={110} />
        <Text style={[styles.heroTitle, { color: colors.ink }]}>Panda Mask</Text>
        <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
          Choose how you'd like to appear in this conversation.
        </Text>
      </View>

      <View style={[styles.note, { backgroundColor: colors.surfaceAlt }]}>
        <IconBadge icon="shield-outline" size={34} />
        <Text style={[type.caption, { color: colors.ink, flex: 1 }]}>
          The mentor will see the status you choose, not your actual status.
        </Text>
      </View>

      <Text style={[styles.section, { color: colors.ink }]}>
        Choose a status for this conversation
      </Text>
      {STATUSES.map((s) => (
        <RadioRow
          key={s.label}
          icon={s.icon}
          tone={s.tone}
          title={s.label}
          body={s.body}
          selected={choice === s.label}
          onPress={() => setChoice(s.label)}
          testID={`mask-${s.label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
        />
      ))}

      <View style={[styles.note, { backgroundColor: colors.surfaceAlt }]}>
        <Panda pose="shield" size={56} />
        <View style={{ flex: 1 }}>
          <Text style={[type.label, { color: colors.ink }]}>Your real status stays private.</Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>
            Only this mentor will see the status you set here. Your actual status won't be shared
            in this conversation.
          </Text>
        </View>
      </View>

      <ConfirmModal
        visible={done}
        art={<Panda pose="excited" size={110} />}
        title="Panda Mask is on!!"
        body={`This mentor now sees you as "${choice ?? ''}".`}
        cta="Got it"
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

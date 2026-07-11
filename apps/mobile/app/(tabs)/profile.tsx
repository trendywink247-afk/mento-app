import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { Companion } from '@/components/art/Companion';
import type { CompanionAnimal } from '@/components/art/Companions';
import { Panda } from '@/components/art/Panda';
import { PersonaAvatar } from '@/components/art/PersonaAvatar';
import { clearSession, getCompanionAnimal, getPersona, type Persona } from '@/lib/session';
import { useTheme } from '@/theme/ThemeProvider';
import {
  COMPANION_COLOR_LABELS,
  COMPANION_COLORS,
  DEFAULT_COMPANION_COLOR,
  type CompanionColor,
} from '@/theme/companion';
import { font, radius, space, type } from '@/theme/tokens';

const COLOR_KEYS = Object.keys(COMPANION_COLORS) as CompanionColor[];

/** Lightweight v1 Profile: persona identity, live companion-colour switcher,
 * support & about. (Mirror/UPSC panels are deferred modules.) */
export default function ProfileTab() {
  const router = useRouter();
  const { colors, elevation, companionColor, setCompanionColor } = useTheme();
  const [persona, setPersona] = useState<Persona | null>(null);
  const [animal, setAnimal] = useState<CompanionAnimal | null>(null);
  const [confirmFresh, setConfirmFresh] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const startFresh = async () => {
    if (leaving) return;
    setLeaving(true);
    setCompanionColor(DEFAULT_COMPANION_COLOR); // un-tint before the new onboarding picks its own
    await clearSession();
    setConfirmFresh(false);
    router.replace('/');
  };

  useEffect(() => {
    let active = true;
    void getPersona().then((p) => {
      if (active) setPersona(p);
    });
    void getCompanionAnimal().then((a) => {
      if (active) setAnimal((a as CompanionAnimal | null) ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space.lg }}>
        <Text style={[type.displaySerif, { color: colors.ink }]} accessibilityRole="header">
          Profile
        </Text>

        <View style={styles.identity}>
          <PersonaAvatar name={persona?.persona_name ?? 'Mento'} size={88} />
          <Text style={[styles.name, { color: colors.ink }]}>
            {persona?.persona_name ?? 'Anonymous'}
          </Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>
            Your identity stays yours — this is all anyone ever sees.
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface }, elevation.sm]}>
          <Text style={[styles.cardTitle, { color: colors.ink }]}>Your growth companion</Text>
          {animal ? (
            <View style={styles.companionRow}>
              <View style={[styles.companionBubble, { backgroundColor: colors.accentTint }]}>
                <Companion animal={animal} size={44} />
              </View>
              <Text style={[type.bodySemi, { color: colors.ink }]}>
                {COMPANION_COLOR_LABELS[companionColor]} {animal}
              </Text>
            </View>
          ) : null}
          <Text style={[type.caption, { color: colors.inkMuted }]}>
            Switching colours re-tints the whole app, instantly.
          </Text>
          <View style={styles.swatches}>
            {COLOR_KEYS.map((key) => {
              const selected = key === companionColor;
              const set = COMPANION_COLORS[key];
              return (
                <Pressable
                  key={key}
                  onPress={() => setCompanionColor(key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${COMPANION_COLOR_LABELS[key]} theme`}
                  testID={`profile-colour-${key}`}
                  style={[styles.swatchWrap, selected && { borderColor: set.accent, borderWidth: 2 }]}
                >
                  <View style={[styles.swatch, { backgroundColor: set.accent }]}>
                    {selected ? <Ionicons name="checkmark" size={14} color={set.onAccent} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Text style={[styles.section, { color: colors.ink }]}>Support & About</Text>

        <Pressable
          onPress={() => router.push('/coffee')}
          accessibilityRole="button"
          testID="profile-coffee"
          style={[styles.row, { backgroundColor: colors.surface }, elevation.sm]}
        >
          <IconBadge icon="cafe-outline" tone="orange" size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: colors.ink }]}>Buy the Mento Team a Coffee</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              Optional, always — it keeps this space free and safe.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
        </Pressable>

        <View style={[styles.row, { backgroundColor: colors.surface }, elevation.sm]}>
          <IconBadge icon="heart-outline" size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: colors.ink }]}>Listeners, not therapists</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              Mento connects you with real people who listen. For clinical support, please reach
              a professional — in a crisis, call Tele-MANAS (14416), free, 24×7.
            </Text>
          </View>
        </View>

        <View style={[styles.row, { backgroundColor: colors.surface }, elevation.sm]}>
          <IconBadge icon="shield-checkmark-outline" tone="green" size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: colors.ink }]}>Privacy, plainly</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              No real names. No photos. Panda Wipe deletes a conversation from your device and
              our servers. Analytics never see your messages.
            </Text>
          </View>
        </View>

        <Pressable
          onPress={() => setConfirmFresh(true)}
          accessibilityRole="button"
          testID="profile-start-fresh"
          style={[styles.row, { backgroundColor: colors.surface }, elevation.sm]}
        >
          <IconBadge icon="leaf-outline" tone="danger" size={44} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: colors.danger }]}>Start fresh</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              Leave this persona behind and begin again as someone new.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
        </Pressable>

        <Text style={[type.caption, styles.version, { color: colors.inkMuted }]}>
          Mento · early access
        </Text>
      </ScrollView>

      <Modal visible={confirmFresh} transparent animationType="fade" onRequestClose={() => setConfirmFresh(false)}>
        <View style={[styles.modalBackdrop, { backgroundColor: colors.scrim }]}>
          <View style={[styles.modalCard, { backgroundColor: colors.surface }, elevation.md]} testID="start-fresh-modal">
            <Panda pose="wave" size={110} />
            <Text style={[styles.modalTitle, { color: colors.ink }]}>Start fresh?</Text>
            <Text style={[type.body, { color: colors.inkMuted, textAlign: 'center' }]}>
              You&apos;ll get a brand-new anonymous persona.{' '}
              {persona?.persona_name ?? 'This persona'}&apos;s chats and journals stay behind —
              there&apos;s no way back to them.
            </Text>
            <View style={styles.modalActions}>
              <PrimaryButton
                label="Yes, start fresh"
                onPress={() => void startFresh()}
                loading={leaving}
                testID="start-fresh-confirm"
              />
              <PrimaryButton
                label="Keep my space"
                variant="link"
                onPress={() => setConfirmFresh(false)}
                disabled={leaving}
                testID="start-fresh-cancel"
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: 'center', gap: space.xs, marginVertical: space.md },
  name: { fontFamily: font.serifBold, fontSize: 26, lineHeight: 33 },
  card: { borderRadius: radius.lg, padding: space.md, gap: space.xs },
  cardTitle: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 23 },
  companionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.sm,
    marginBottom: space.xs,
  },
  companionBubble: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  swatchWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { fontFamily: font.sansBold, fontSize: 18, lineHeight: 25, marginTop: space.lg, marginBottom: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.sm + 2,
    marginBottom: space.sm,
  },
  version: { textAlign: 'center', marginTop: space.md },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  modalCard: {
    alignSelf: 'stretch',
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
    alignItems: 'center',
  },
  modalTitle: { fontFamily: font.serifBold, fontSize: 24, lineHeight: 30, textAlign: 'center' },
  modalActions: { alignSelf: 'stretch', gap: space.xs, marginTop: space.sm },
});

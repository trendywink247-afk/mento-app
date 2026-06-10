import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { Screen } from '@/components/Screen';
import { Panda } from '@/components/art/Panda';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type } from '@/theme/tokens';

const AMOUNTS = [49, 99, 199, 499] as const;

const METHODS: { key: string; icon: keyof typeof Ionicons.glyphMap; title: string; body: string }[] = [
  { key: 'upi', icon: 'phone-portrait-outline', title: 'UPI', body: 'Pay using any UPI app' },
  { key: 'card', icon: 'card-outline', title: 'Card', body: 'Debit / Credit card' },
  { key: 'netbanking', icon: 'business-outline', title: 'Net Banking', body: 'Pay using your bank' },
];

/**
 * Buy the Mento Team a Coffee (mockup #28; #24 adds the post-reflection headline via
 * ?energy=high). Honest-money rules (T&S #4): opt-in, supports the TEAM, never inside
 * a live conversation, never framed as membership. Payments go live with Razorpay;
 * until then methods are visible but transparently disabled.
 */
export default function CoffeeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { energy } = useLocalSearchParams<{ energy?: string }>();
  const [amount, setAmount] = useState<number>(49);
  const [custom, setCustom] = useState('');
  const [customOpen, setCustomOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const effective = customOpen && custom ? Number(custom) || 0 : amount;

  const onMethod = () => {
    // Razorpay checkout lands with payment creds; stay transparent meanwhile.
    setNote(
      'Payments are coming very soon. Thank you for wanting to support the team — it means a lot. 💜',
    );
  };

  return (
    <Screen bg="lavender" onBack={() => router.back()} scroll>
      <View style={styles.hero}>
        <Panda pose="coffee" size={130} />
        {energy === 'high' ? (
          <Text style={[styles.heroTitle, { color: colors.ink }]}>
            Wow! You left feeling{'\n'}
            <Text style={{ color: colors.accentSoft }}>high energy! ⚡</Text>
          </Text>
        ) : null}
        {energy === 'high' ? (
          <Text style={[type.body, { color: colors.inkMuted }]}>That's amazing to hear! ✨</Text>
        ) : null}
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <View style={styles.askRow}>
          <Panda pose="excited" size={56} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: colors.ink }]}>
              Would you like to buy a coffee for the Mento team? ☕
            </Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>
              It keeps our pandas fueled up to build a safe space for more hearts. 💜
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.heroAmount, { backgroundColor: colors.surfaceAlt }]}>
        <IconBadge icon="cafe-outline" size={52} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.amountText, { color: colors.ink }]}>₹{effective || amount}</Text>
          <Text style={[type.caption, { color: colors.inkMuted }]}>For one coffee</Text>
        </View>
        <View style={styles.supportRow}>
          <Ionicons name="heart-outline" size={16} color={colors.accent} />
          <Text style={[type.caption, { color: colors.accent }]}>Support Mento</Text>
        </View>
      </View>

      <Text style={[styles.section, { color: colors.ink }]}>Other amount</Text>
      <View style={styles.chips}>
        {AMOUNTS.map((a) => {
          const selected = !customOpen && amount === a;
          return (
            <Pressable
              key={a}
              onPress={() => {
                setAmount(a);
                setCustomOpen(false);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              testID={`amount-${a}`}
              style={[
                styles.chip,
                { borderColor: selected ? colors.accent : colors.border, backgroundColor: colors.surface },
                selected && { borderWidth: 1.5 },
              ]}
            >
              <Text style={[type.label, { color: selected ? colors.accent : colors.ink }]}>₹{a}</Text>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => setCustomOpen(true)}
          accessibilityRole="button"
          accessibilityState={{ selected: customOpen }}
          testID="amount-custom"
          style={[
            styles.chip,
            { borderColor: customOpen ? colors.accent : colors.border, backgroundColor: colors.surface },
            customOpen && { borderWidth: 1.5 },
          ]}
        >
          <Text style={[type.label, { color: customOpen ? colors.accent : colors.ink }]}>Custom</Text>
        </Pressable>
      </View>
      {customOpen ? (
        <TextInput
          style={[styles.customInput, { borderColor: colors.border, backgroundColor: colors.surface, color: colors.ink }]}
          placeholder="Enter an amount (₹)"
          placeholderTextColor={colors.inkMuted}
          keyboardType="number-pad"
          value={custom}
          onChangeText={setCustom}
          maxLength={6}
          accessibilityLabel="Custom contribution amount in rupees"
          testID="custom-amount"
        />
      ) : null}

      <Text style={[styles.section, { color: colors.ink }]}>Choose a payment method</Text>
      {METHODS.map((m) => (
        <Pressable
          key={m.key}
          onPress={onMethod}
          accessibilityRole="button"
          accessibilityLabel={`${m.title} — coming soon`}
          testID={`method-${m.key}`}
          style={[styles.method, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <IconBadge icon={m.icon} size={40} />
          <View style={{ flex: 1 }}>
            <Text style={[type.label, { color: colors.ink }]}>{m.title}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{m.body}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.inkMuted} />
        </Pressable>
      ))}
      {note ? (
        <View style={[styles.noteCard, { backgroundColor: colors.surfaceAlt }]} testID="payments-note">
          <IconBadge icon="time-outline" tone="orange" size={34} />
          <Text style={[type.caption, { color: colors.ink, flex: 1 }]}>{note}</Text>
        </View>
      ) : null}

      <View style={[styles.noteCard, { backgroundColor: colors.surfaceAlt }]}>
        <Panda pose="shield" size={48} />
        <Text style={[type.caption, { color: colors.ink, flex: 1 }]}>
          Thank you! Your support goes to the Mento team — keeping this space safe, free, and
          here for everyone. 💜
        </Text>
      </View>

      <View style={styles.secureRow}>
        <Ionicons name="lock-closed-outline" size={13} color={colors.inkMuted} />
        <Text style={[type.caption, { color: colors.inkMuted }]}>
          Secure payment · Encrypted & safe
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.xs, marginBottom: space.md },
  heroTitle: {
    fontFamily: font.sansHeavy,
    fontSize: 26,
    lineHeight: 34,
    textAlign: 'center',
  },
  card: { borderRadius: radius.lg, padding: space.md, marginBottom: space.sm },
  askRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  heroAmount: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    padding: space.md,
  },
  amountText: { fontFamily: font.sansHeavy, fontSize: 26, lineHeight: 32 },
  supportRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  section: { fontFamily: font.sansBold, fontSize: 16, lineHeight: 22, marginTop: space.md, marginBottom: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
  },
  customInput: {
    height: 50,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    marginTop: space.sm,
    ...type.body,
  },
  method: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.sm,
    marginBottom: space.sm,
  },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    padding: space.sm,
    marginTop: space.sm,
  },
  secureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    marginTop: space.md,
  },
});

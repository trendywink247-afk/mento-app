import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { SceneTile } from '@/components/art/SceneTile';
import { api, type JournalEntry } from '@/lib/api';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, type Wash } from '@/theme/tokens';

const MOODS = ['Calm', 'Happy', 'Okay', 'Low', 'Anxious'] as const;
const FINANCE_CATEGORIES = ['Food', 'Travel', 'Books', 'Rent', 'Other'] as const;

type Config = {
  channel: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: Wash;
  empty: string;
  composer: 'mood' | 'finance' | 'note' | 'none';
};

const CONFIGS: Record<string, Config> = {
  'mentor-notes': {
    channel: 'mentor_notes',
    title: 'Mentor Notes',
    icon: 'book-outline',
    tone: 'accent',
    empty: 'Words worth keeping will land here. Long-press a mentor message in chat to save it.',
    composer: 'none',
  },
  mood: {
    channel: 'mood',
    title: 'Mood Journal',
    icon: 'heart-outline',
    tone: 'danger',
    empty: 'How are you feeling today? Your first entry is one tap away.',
    composer: 'mood',
  },
  finance: {
    channel: 'finance',
    title: 'Finance Journal',
    icon: 'wallet-outline',
    tone: 'green',
    empty: 'Track an expense or income — small notes add up to clarity.',
    composer: 'finance',
  },
  gratitude: {
    channel: 'gratitude',
    title: 'Gratitude Journal',
    icon: 'leaf-outline',
    tone: 'orange',
    empty: "One good thing from today — that's all it takes.",
    composer: 'note',
  },
};

/** One journal surface for all channels: list + the channel's manual composer
 * (Mentor Notes is read-only here — it's fed from chat). */
export default function JournalScreen() {
  const router = useRouter();
  const { colors, elevation } = useTheme();
  const { channel: route } = useLocalSearchParams<{ channel: string }>();
  const cfg = CONFIGS[route ?? ''] ?? CONFIGS['mentor-notes'];

  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Composer state.
  const [note, setNote] = useState('');
  const [mood, setMood] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'expense' | 'income'>('expense');
  const [category, setCategory] = useState<string>('Other');

  const load = useCallback(async () => {
    try {
      const rows =
        cfg.channel === 'mentor_notes'
          ? await api.listMentorNotes()
          : await api.listJournalEntries(cfg.channel);
      setEntries(rows);
    } catch {
      // Keep the screen quiet — entries stay empty with the empty-state copy.
    } finally {
      setLoading(false);
    }
  }, [cfg.channel]);

  useEffect(() => {
    void load();
  }, [load]);

  const canSave =
    cfg.composer === 'mood'
      ? Boolean(mood)
      : cfg.composer === 'finance'
        ? Number(amount) > 0
        : cfg.composer === 'note'
          ? note.trim().length > 0
          : false;

  const save = async () => {
    if (!canSave || busy) return;
    setBusy(true);
    try {
      if (cfg.composer === 'mood') {
        await api.createJournalEntry({
          channel: 'mood',
          body: note.trim() || (mood as string),
          meta: { mood },
        });
      } else if (cfg.composer === 'finance') {
        await api.createJournalEntry({
          channel: 'finance',
          body: note.trim() || category,
          meta: { amount_paise: Math.round(Number(amount) * 100), direction, category },
        });
      } else {
        await api.createJournalEntry({ channel: cfg.channel, body: note.trim() });
      }
      setNote('');
      setMood(null);
      setAmount('');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const renderEntry = ({ item }: { item: JournalEntry }) => {
    const when = new Date(item.created_at).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
    });
    return (
      <View style={[styles.entry, { backgroundColor: colors.surface }, elevation.sm]}>
        {cfg.composer === 'finance' && item.meta.amount_paise ? (
          <View style={styles.financeRow}>
            <Text
              style={[
                styles.amount,
                { color: item.meta.direction === 'income' ? colors.success : colors.ink },
              ]}
            >
              {item.meta.direction === 'income' ? '+' : '−'}₹
              {(Number(item.meta.amount_paise) / 100).toLocaleString('en-IN')}
            </Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{when}</Text>
          </View>
        ) : null}
        {cfg.channel === 'mood' && item.meta.mood ? (
          <View style={styles.financeRow}>
            <Text style={[type.label, { color: colors.accent }]}>{String(item.meta.mood)}</Text>
            <Text style={[type.caption, { color: colors.inkMuted }]}>{when}</Text>
          </View>
        ) : null}
        <Text style={[type.body, { color: colors.ink }]}>{item.body}</Text>
        {cfg.channel === 'mentor_notes' ? (
          <Text style={[type.caption, { color: colors.inkMuted, marginTop: space.xs }]}>
            {item.meta.listener_persona ? `${item.meta.listener_persona} · ` : ''}
            {when}
          </Text>
        ) : null}
        {cfg.composer === 'note' || (cfg.channel === 'mood' && !item.meta.mood) ? (
          <Text style={[type.caption, { color: colors.inkMuted, marginTop: space.xs }]}>{when}</Text>
        ) : null}
      </View>
    );
  };

  return (
    <Screen onBack={() => router.back()}>
      <View style={styles.head}>
        <IconBadge icon={cfg.icon} tone={cfg.tone} size={44} />
        <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
          {cfg.title}
        </Text>
      </View>

      {cfg.composer === 'mood' ? (
        <View style={[styles.composer, { backgroundColor: colors.surface }, elevation.sm]}>
          <Text style={[type.label, { color: colors.ink }]}>How are you feeling?</Text>
          <View style={styles.chips}>
            {MOODS.map((m) => {
              const selected = mood === m;
              return (
                <Pressable
                  key={m}
                  onPress={() => setMood(selected ? null : m)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  testID={`mood-${m.toLowerCase()}`}
                  style={[
                    styles.chip,
                    selected
                      ? { backgroundColor: colors.accent }
                      : { borderWidth: 1, borderColor: colors.accentSoft },
                  ]}
                >
                  <Text style={[styles.chipText, { color: selected ? colors.onAccent : colors.accent }]}>
                    {m}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.ink }]}
            placeholder="Add a note (optional)"
            placeholderTextColor={colors.inkMuted}
            value={note}
            onChangeText={setNote}
            testID="journal-note"
          />
          <PrimaryButton label="Save entry" onPress={() => void save()} disabled={!canSave} loading={busy} testID="journal-save" />
        </View>
      ) : null}

      {cfg.composer === 'finance' ? (
        <View style={[styles.composer, { backgroundColor: colors.surface }, elevation.sm]}>
          <View style={styles.financeInputRow}>
            <TextInput
              style={[styles.input, styles.amountInput, { borderColor: colors.border, color: colors.ink }]}
              placeholder="₹ 0"
              placeholderTextColor={colors.inkMuted}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              accessibilityLabel="Amount in rupees"
              testID="finance-amount"
            />
            <View style={styles.chips}>
              {(['expense', 'income'] as const).map((d) => {
                const selected = direction === d;
                return (
                  <Pressable
                    key={d}
                    onPress={() => setDirection(d)}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    testID={`direction-${d}`}
                    style={[
                      styles.chip,
                      selected
                        ? { backgroundColor: d === 'income' ? colors.success : colors.accent }
                        : { borderWidth: 1, borderColor: colors.border },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: selected ? colors.onAccent : colors.inkMuted }]}>
                      {d === 'expense' ? 'Expense' : 'Income'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <View style={styles.chips}>
            {FINANCE_CATEGORIES.map((c) => {
              const selected = category === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => setCategory(c)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  style={[
                    styles.chip,
                    selected
                      ? { backgroundColor: colors.surfaceAlt }
                      : { borderWidth: 1, borderColor: colors.border },
                  ]}
                >
                  <Text style={[styles.chipText, { color: selected ? colors.accent : colors.inkMuted }]}>
                    {c}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.ink }]}
            placeholder="What was it? (optional)"
            placeholderTextColor={colors.inkMuted}
            value={note}
            onChangeText={setNote}
            testID="journal-note"
          />
          <PrimaryButton label="Save entry" onPress={() => void save()} disabled={!canSave} loading={busy} testID="journal-save" />
        </View>
      ) : null}

      {cfg.composer === 'note' ? (
        <View style={[styles.composer, { backgroundColor: colors.surface }, elevation.sm]}>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.ink }]}
            placeholder="Today I'm grateful for…"
            placeholderTextColor={colors.inkMuted}
            value={note}
            onChangeText={setNote}
            testID="journal-note"
          />
          <PrimaryButton label="Save entry" onPress={() => void save()} disabled={!canSave} loading={busy} testID="journal-save" />
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.id}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ gap: space.sm, paddingVertical: space.sm, flexGrow: 1 }}
          ListEmptyComponent={
            <View style={styles.center}>
              <SceneTile name="journalEmpty" size={120} />
              <Text style={[type.body, styles.centerText, { color: colors.inkMuted }]}>{cfg.empty}</Text>
            </View>
          }
          renderItem={renderEntry}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md },
  title: { fontFamily: font.serifBold, fontSize: 26, lineHeight: 33 },
  composer: { borderRadius: radius.lg, padding: space.md, gap: space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { borderRadius: radius.pill, paddingVertical: space.xs + 2, paddingHorizontal: space.sm + 4 },
  chipText: { fontFamily: font.sansBold, fontSize: 13, lineHeight: 18 },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    ...type.body,
  },
  financeInputRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  amountInput: { width: 110, fontFamily: font.sansBold },
  entry: { borderRadius: radius.md, padding: space.md },
  financeRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: space.xs },
  amount: { fontFamily: font.sansBold, fontSize: 17, lineHeight: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.lg },
  centerText: { textAlign: 'center', paddingHorizontal: space.lg },
});

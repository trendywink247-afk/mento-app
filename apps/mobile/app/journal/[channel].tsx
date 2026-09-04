import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { EdgeSurface } from '@/components/EdgeSurface';
import { IconBadge } from '@/components/IconBadge';
import { PrimaryButton } from '@/components/PrimaryButton';
import { Screen } from '@/components/Screen';
import { LottieTile } from '@/components/art/LottieTile';
import { SceneTile } from '@/components/art/SceneTile';
import { PressKey } from '@/components/motion/PressKey';
import { api, type JournalEntry } from '@/lib/api';
import { useI18n, type TKey } from '@/lib/i18n';
import { useTheme } from '@/theme/ThemeProvider';
import { font, radius, space, type, type Wash } from '@/theme/tokens';

/** Canonical mood values — stored in entry meta and used for testIDs; only the
 * displayed chip label translates. */
const MOODS = ['Calm', 'Happy', 'Okay', 'Low', 'Anxious'] as const;
/** Weather glyphs for the mood chips — feelings as sky, in the brand's aurora language. */
const MOOD_ICONS: Record<(typeof MOODS)[number], keyof typeof Ionicons.glyphMap> = {
  Calm: 'leaf-outline',
  Happy: 'sunny-outline',
  Okay: 'cloud-outline',
  Low: 'rainy-outline',
  Anxious: 'thunderstorm-outline',
};
const MOOD_LABELS: Record<(typeof MOODS)[number], TKey> = {
  Calm: 'journals.moodCalm',
  Happy: 'journals.moodHappy',
  Okay: 'journals.moodOkay',
  Low: 'journals.moodLow',
  Anxious: 'journals.moodAnxious',
};
/** Canonical category values — stored in entry meta; the chip label translates. */
const FINANCE_CATEGORIES = ['Food', 'Travel', 'Books', 'Rent', 'Other'] as const;
const CATEGORY_LABELS: Record<(typeof FINANCE_CATEGORIES)[number], TKey> = {
  Food: 'journals.catFood',
  Travel: 'journals.catTravel',
  Books: 'journals.catBooks',
  Rent: 'journals.catRent',
  Other: 'journals.catOther',
};

type Config = {
  channel: string;
  title: TKey;
  icon: keyof typeof Ionicons.glyphMap;
  tone: Wash;
  empty: TKey;
  composer: 'mood' | 'finance' | 'note' | 'none';
};

const CONFIGS: Record<string, Config> = {
  'mentor-notes': {
    channel: 'mentor_notes',
    title: 'journals.mentorNotesTitle',
    icon: 'book-outline',
    tone: 'accent',
    empty: 'journals.emptyMentorNotes',
    composer: 'none',
  },
  mood: {
    channel: 'mood',
    title: 'journals.moodTitle',
    icon: 'heart-outline',
    tone: 'danger',
    empty: 'journals.emptyMood',
    composer: 'mood',
  },
  finance: {
    channel: 'finance',
    title: 'journals.financeTitle',
    icon: 'wallet-outline',
    tone: 'green',
    empty: 'journals.emptyFinance',
    composer: 'finance',
  },
  gratitude: {
    channel: 'gratitude',
    title: 'journals.gratitudeTitle',
    icon: 'leaf-outline',
    tone: 'orange',
    empty: 'journals.emptyGratitude',
    composer: 'note',
  },
};

/** One journal surface for all channels: list + the channel's manual composer
 * (Mentor Notes is read-only here — it's fed from chat). */
export default function JournalScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
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
      <EdgeSurface edge={colors.edgeSurface} style={[styles.entry, { backgroundColor: colors.surface }]}>
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
            <Text style={[type.label, { color: colors.accent }]}>
              {MOOD_LABELS[String(item.meta.mood) as (typeof MOODS)[number]]
                ? t(MOOD_LABELS[String(item.meta.mood) as (typeof MOODS)[number]])
                : String(item.meta.mood)}
            </Text>
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
      </EdgeSurface>
    );
  };

  return (
    <Screen onBack={() => router.back()}>
      <View style={styles.head}>
        <IconBadge icon={cfg.icon} tone={cfg.tone} size={44} />
        <Text style={[styles.title, { color: colors.ink }]} accessibilityRole="header">
          {t(cfg.title)}
        </Text>
      </View>

      {cfg.composer === 'mood' ? (
        <EdgeSurface
          edge={colors.edgeSurface}
          style={[styles.composer, { backgroundColor: colors.surface }]}
          containerStyle={{ marginBottom: space.md }}
        >
          <Text style={[type.label, { color: colors.ink }]}>{t('journals.howFeeling')}</Text>
          <View style={styles.chips}>
            {MOODS.map((m) => {
              const selected = mood === m;
              return (
                <PressKey
                  key={m}
                  onPress={() => setMood(selected ? null : m)}
                  edge={selected ? colors.accentEdge : colors.edgeAlt}
                  travel={3}
                  radius={radius.pill}
                  accessibilityState={{ selected }}
                  testID={`mood-${m.toLowerCase()}`}
                  style={[
                    styles.chip,
                    { backgroundColor: selected ? colors.accentTint : colors.surfaceAlt },
                  ]}
                >
                  <Ionicons
                    name={MOOD_ICONS[m]}
                    size={14}
                    color={selected ? colors.accent : colors.inkMuted}
                  />
                  <Text style={[styles.chipText, { color: selected ? colors.accent : colors.ink }]}>
                    {t(MOOD_LABELS[m])}
                  </Text>
                </PressKey>
              );
            })}
          </View>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.ink }]}
            placeholder={t('journals.addNote')}
            placeholderTextColor={colors.inkMuted}
            value={note}
            onChangeText={setNote}
            testID="journal-note"
          />
          <PrimaryButton label={t('journals.saveEntry')} onPress={() => void save()} disabled={!canSave} loading={busy} testID="journal-save" />
        </EdgeSurface>
      ) : null}

      {cfg.composer === 'finance' ? (
        <EdgeSurface
          edge={colors.edgeSurface}
          style={[styles.composer, { backgroundColor: colors.surface }]}
          containerStyle={{ marginBottom: space.md }}
        >
          <View style={styles.financeInputRow}>
            <TextInput
              style={[styles.input, styles.amountInput, { borderColor: colors.border, color: colors.ink }]}
              placeholder={t('journals.amountPlaceholder')}
              placeholderTextColor={colors.inkMuted}
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={setAmount}
              accessibilityLabel={t('journals.amountA11y')}
              testID="finance-amount"
            />
            <View style={styles.chips}>
              {(['expense', 'income'] as const).map((d) => {
                const selected = direction === d;
                return (
                  <PressKey
                    key={d}
                    onPress={() => setDirection(d)}
                    edge={
                      selected
                        ? d === 'income'
                          ? colors.edgeInk
                          : colors.accentEdge
                        : colors.edgeAlt
                    }
                    travel={3}
                    radius={radius.pill}
                    accessibilityState={{ selected }}
                    testID={`direction-${d}`}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: selected
                          ? d === 'income'
                            ? colors.success
                            : colors.accent
                          : colors.surfaceAlt,
                      },
                    ]}
                  >
                    <Text style={[styles.chipText, { color: selected ? colors.onAccent : colors.inkMuted }]}>
                      {d === 'expense' ? t('journals.expense') : t('journals.income')}
                    </Text>
                  </PressKey>
                );
              })}
            </View>
          </View>
          <View style={styles.chips}>
            {FINANCE_CATEGORIES.map((c) => {
              const selected = category === c;
              return (
                <PressKey
                  key={c}
                  onPress={() => setCategory(c)}
                  edge={selected ? colors.accentEdge : colors.edgeAlt}
                  travel={3}
                  radius={radius.pill}
                  accessibilityState={{ selected }}
                  style={[
                    styles.chip,
                    { backgroundColor: selected ? colors.accentTint : colors.surfaceAlt },
                  ]}
                >
                  <Text style={[styles.chipText, { color: selected ? colors.accent : colors.inkMuted }]}>
                    {t(CATEGORY_LABELS[c])}
                  </Text>
                </PressKey>
              );
            })}
          </View>
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.ink }]}
            placeholder={t('journals.whatWasIt')}
            placeholderTextColor={colors.inkMuted}
            value={note}
            onChangeText={setNote}
            testID="journal-note"
          />
          <PrimaryButton label={t('journals.saveEntry')} onPress={() => void save()} disabled={!canSave} loading={busy} testID="journal-save" />
        </EdgeSurface>
      ) : null}

      {cfg.composer === 'note' ? (
        <EdgeSurface
          edge={colors.edgeSurface}
          style={[styles.composer, { backgroundColor: colors.surface }]}
          containerStyle={{ marginBottom: space.md }}
        >
          <TextInput
            style={[styles.input, { borderColor: colors.border, color: colors.ink }]}
            placeholder={t('journals.gratitudePlaceholder')}
            placeholderTextColor={colors.inkMuted}
            value={note}
            onChangeText={setNote}
            testID="journal-note"
          />
          <PrimaryButton label={t('journals.saveEntry')} onPress={() => void save()} disabled={!canSave} loading={busy} testID="journal-save" />
        </EdgeSurface>
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
              {cfg.channel === 'finance' ? (
                // The finance journal earns its own scene: coins into the piggy.
                <LottieTile name="piggyBank" fallback="journalEmpty" size={120} />
              ) : (
                <SceneTile name="journalEmpty" size={120} />
              )}
              <Text style={[type.body, styles.centerText, { color: colors.inkMuted }]}>{t(cfg.empty)}</Text>
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
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    borderRadius: radius.pill,
    paddingVertical: space.xs + 2,
    paddingHorizontal: space.sm + 4,
  },
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

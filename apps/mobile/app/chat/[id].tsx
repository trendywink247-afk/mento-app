import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/lib/api';
import { colors, radius, space, type } from '@/theme/tokens';

/**
 * Chat shell for the v1 slice. Renders the matched persona, runs the crisis scan on
 * every outbound message (PRD §10), and shows support-and-refer when triggered.
 *
 * TODO(next unit): replace the local message state with the Stream Chat channel
 * (stream-chat-expo) using the stored stream_token + match.stream_channel_id, for
 * real-time delivery, typing, and read state.
 */

type Msg = { id: string; text: string; mine: boolean };
type Crisis = { message: string; helplines: { name: string; number: string; hours: string }[] };

export default function ChatScreen() {
  const router = useRouter();
  const { id, listener } = useLocalSearchParams<{ id: string; listener?: string }>();
  const listenerName = listener ?? 'Your listener';

  const [messages, setMessages] = useState<Msg[]>([
    { id: 'greet', text: 'Hello. How are you? What brings you here today?', mine: false },
  ]);
  const [text, setText] = useState('');
  const [crisis, setCrisis] = useState<Crisis | null>(null);
  const counter = useRef(0);

  const send = async () => {
    const body = text.trim();
    if (!body) return;
    setText('');
    counter.current += 1;
    setMessages((m) => [...m, { id: `m${counter.current}`, text: body, mine: true }]);

    try {
      const result = await api.scan({ text: body, conversation_id: id });
      if (result.triggered && result.message) {
        setCrisis({ message: result.message, helplines: result.helplines });
      }
    } catch {
      /* scan failures must never block the conversation */
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => router.replace('/')} hitSlop={12}>
          <Ionicons name="chevron-back" size={24} color={colors.ink} />
        </Pressable>
        <View style={styles.avatar}>
          <Ionicons name="leaf-outline" size={18} color={colors.brand} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={type.label}>{listenerName}</Text>
          <Text style={styles.status}>● Connected</Text>
        </View>
        <Ionicons name="ellipsis-vertical" size={20} color={colors.inkMuted} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}
      >
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.mine ? styles.mine : styles.theirs]}>
              <Text style={[type.body, { color: item.mine ? colors.onBrand : colors.ink }]}>
                {item.text}
              </Text>
            </View>
          )}
        />

        {crisis ? <CrisisCard crisis={crisis} onDismiss={() => setCrisis(null)} /> : null}

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Type a message…"
            placeholderTextColor={colors.inkMuted}
            value={text}
            onChangeText={setText}
            multiline
          />
          <Pressable style={styles.sendBtn} onPress={() => void send()}>
            <Ionicons name="arrow-up" size={20} color={colors.onBrand} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function CrisisCard({ crisis, onDismiss }: { crisis: Crisis; onDismiss: () => void }) {
  return (
    <View style={styles.crisis}>
      <Text style={styles.crisisText}>{crisis.message}</Text>
      <View style={{ gap: space.sm }}>
        {crisis.helplines.map((h) => (
          <Pressable
            key={h.number}
            style={styles.helpline}
            onPress={() => void Linking.openURL(`tel:${h.number}`)}
          >
            <Ionicons name="call-outline" size={18} color={colors.brand} />
            <Text style={type.label}>
              {h.name} · {h.number}
            </Text>
            <Text style={styles.hours}>{h.hours}</Text>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={onDismiss} hitSlop={8} style={styles.crisisDismiss}>
        <Text style={[type.caption, { color: colors.brand }]}>Close</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  status: { ...type.caption, color: colors.success },
  list: { padding: space.md, gap: space.sm },
  bubble: { maxWidth: '80%', borderRadius: radius.lg, padding: space.md },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.brand, borderBottomRightRadius: radius.sm },
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderBottomLeftRadius: radius.sm,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 44,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    ...type.body,
    color: colors.ink,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crisis: {
    margin: space.md,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandTint,
    borderWidth: 1,
    borderColor: colors.brand,
    gap: space.sm,
  },
  crisisText: { ...type.body, color: colors.ink },
  helpline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    padding: space.sm,
  },
  hours: { ...type.caption, marginLeft: 'auto' },
  crisisDismiss: { alignSelf: 'flex-end' },
});

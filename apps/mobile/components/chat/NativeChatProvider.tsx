import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';

import { PrimaryButton } from '@/components/PrimaryButton';
import { OwnNativeChatScreen } from '@/components/chat/OwnNativeChatScreen';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { listenerApi } from '@/lib/listenerApi';
import { leaveToChats, leaveToMentorHome } from '@/lib/leaveToChats';
import { nativeChatRenderer } from '@/lib/nativeChatOwner';
import { useTheme } from '@/theme/ThemeProvider';

/** Authoritative selection precedes either renderer. The native gate is separate
 * from web acceptance; matching and persisted Stream rooms remain unchanged.
 */
export function NativeChatProvider({ role, stream }: {
  role: 'member' | 'mentor'; stream: ReactNode;
}) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useI18n();
  const [owner, setOwner] = useState<'stream' | 'own' | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setOwner(null); setError(false);
    void (async () => {
      try {
        if (!id) throw new Error('conversation_required');
        const state = role === 'member' ? await api.conversationState(id) : await listenerApi.brief(id);
        const renderer = nativeChatRenderer(state.chat_backend, {
          native: process.env.EXPO_PUBLIC_OWN_CHAT_NATIVE_ACCEPTED,
          own: process.env.EXPO_PUBLIC_OWN_CHAT_ACCEPTED,
        });
        if (live) setOwner(renderer);
      } catch { if (live) setError(true); }
    })();
    return () => { live = false; };
  }, [id, role, attempt]);
  if (owner === 'stream') return stream;
  if (owner === 'own') return <OwnNativeChatScreen key={`${role}:${id}:${attempt}`} role={role}
    conversationId={id} onRetry={() => setAttempt(value => value + 1)} />;
  return <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16 }}>
    {error ? <><Text style={{ color: colors.ink }}>{t('chat.errOpen')}</Text>
      <PrimaryButton label={t('common.retry')} onPress={() => setAttempt(value => value + 1)} />
      <PrimaryButton label={t('common.back')} variant="ghost"
        onPress={() => role === 'member' ? leaveToChats(router) : leaveToMentorHome(router)} />
    </> : <ActivityIndicator color={colors.accent} />}
  </View>;
}

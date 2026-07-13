/**
 * LottieTile — a themed free Lottie in the SceneTile slot (rounded tile, fixed
 * size). Sources live in assets/lottie/ (themed by scripts/theme_lottie.py;
 * licences in that folder's README).
 *
 * Reduced motion renders the still SceneTile fallback instead — no looping art.
 * Web: LottieView ignores `style`; size comes from webStyle + the wrapper.
 */
import LottieView from 'lottie-react-native';
import { View } from 'react-native';

import { SceneTile } from '@/components/art/SceneTile';
import type { ComponentProps } from 'react';
import { useReducedMotion } from '@/lib/useReducedMotion';
import { useTheme } from '@/theme/ThemeProvider';

type SceneName = ComponentProps<typeof SceneTile>['name'];

export const LOTTIE_TILES = {
  chatDots: require('@/assets/lottie/chat-loading.json'),
  notebook: require('@/assets/lottie/notebook-writing.json'),
  piggyBank: require('@/assets/lottie/piggy-bank.json'),
  breathing: require('@/assets/lottie/breathing-calm.json'),
} as const;

export function LottieTile({
  name,
  fallback,
  size = 140,
}: {
  name: keyof typeof LOTTIE_TILES;
  /** SceneTile shown under reduced motion (and anywhere stillness is kinder). */
  fallback: SceneName;
  size?: number;
}) {
  const reduced = useReducedMotion();
  const { colors } = useTheme();

  if (reduced) return <SceneTile name={fallback} size={size} />;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.24,
        backgroundColor: colors.surface,
        overflow: 'hidden',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <LottieView
        source={LOTTIE_TILES[name]}
        autoPlay
        loop
        style={{ width: '100%', height: '100%' }}
        webStyle={{ width: '100%', height: '100%' }}
      />
    </View>
  );
}

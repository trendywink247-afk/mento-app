/**
 * PlaygroundLoop (native) — the companions-at-play loop on the role fork (board A02),
 * played with expo-video. Silent by construction: the file has NO audio stream, and the
 * player is muted anyway.
 * reason: CLAUDE.md T&S #11 says no audio anywhere — `muted = true` is the belt to the
 * file's braces, so a future re-encode with a stray track still makes no sound.
 *
 * Decorative: no controls, no fullscreen, no picture-in-picture, not focusable, no
 * touches. It plays only while the route is focused. `onPlaying` fires once frames are
 * actually advancing, so the caller can lift the poster without a black first frame
 * (Android draws the video on a SurfaceView, which is black until its first frame).
 */
import { useFocusEffect } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect } from 'react';
import { StyleSheet } from 'react-native';

const SOURCE = require('@/assets/scenes/playground-loop.mp4');

export function PlaygroundLoop({ onPlaying }: { onPlaying: () => void }) {
  const player = useVideoPlayer(SOURCE, (p) => {
    p.loop = true;
    p.muted = true;
    p.timeUpdateEventInterval = 0.25;
  });

  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      if (currentTime > 0.1) onPlaying();
    });
    return () => sub.remove();
  }, [player, onPlaying]);

  useFocusEffect(
    useCallback(() => {
      player.play();
      return () => {
        try {
          player.pause();
        } catch {
          // reason: on unmount the hook has already released the native player — a
          // released player cannot be paused, and does not need to be.
        }
      };
    }, [player])
  );

  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      nativeControls={false}
      fullscreenOptions={{ enable: false }}
      allowsPictureInPicture={false}
      focusable={false}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

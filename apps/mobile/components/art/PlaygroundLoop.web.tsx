/**
 * PlaygroundLoop (web) — the same loop as a plain inline <video>: muted + playsInline so
 * every browser lets it autoplay, no controls, never focusable, hidden from assistive
 * tech (the band's wrapper carries the description). expo-video's web view is not used
 * here: it has no playsInline and builds an AudioContext on the first tap, and this
 * film has no sound to route.
 * reason: CLAUDE.md T&S #11 says no audio anywhere — the file has NO audio stream and
 * `muted` is set as well.
 *
 * It pauses when the route loses focus, and a <video> element unmounts cleanly during
 * route teardown (unlike the DotLottie canvas) — proven in e2e/role-fork.e2e.js.
 */
import { Asset } from 'expo-asset';
import { useFocusEffect } from 'expo-router';
import { createElement, useCallback, useRef } from 'react';

const URI = Asset.fromModule(require('@/assets/scenes/playground-loop.mp4')).uri;

const STYLE = {
  position: 'absolute',
  left: 0,
  top: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  pointerEvents: 'none',
} as const;

export function PlaygroundLoop({ onPlaying }: { onPlaying: () => void }) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useFocusEffect(
    useCallback(() => {
      // Autoplay can be refused (data saver, a browser policy): the still simply stays.
      void ref.current?.play().catch(() => undefined);
      return () => ref.current?.pause();
    }, [])
  );

  return createElement('video', {
    ref,
    src: URI,
    muted: true,
    loop: true,
    autoPlay: true,
    playsInline: true,
    controls: false,
    disablePictureInPicture: true,
    disableRemotePlayback: true,
    preload: 'auto',
    tabIndex: -1,
    'aria-hidden': true,
    'data-testid': 'playground-video',
    onTimeUpdate: (e: { currentTarget: HTMLVideoElement }) => {
      if (e.currentTarget.currentTime > 0.1) onPlaying();
    },
    style: STYLE,
  });
}

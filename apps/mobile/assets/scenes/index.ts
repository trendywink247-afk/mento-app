/**
 * Generated empty-state scene illustrations (Higgsfield / Nano Banana 2,
 * 2026-07-12 — same soft-shaded register as the companion set; originals +
 * job IDs in docs/mascot-candidates/scenes/). Scenes keep their warm-cream
 * background and render as rounded tiles via components/art/SceneTile.
 */
import type { ImageSourcePropType } from 'react-native';

export const SCENES = {
  /** Chat screen "You're connected!" — two voices warmly meeting. */
  chatConnected: require('./chat-connected.webp') as ImageSourcePropType,
  /** My Chats "No conversations yet" — a quiet place ready for a talk. */
  chatsEmpty: require('./chats-empty.webp') as ImageSourcePropType,
  /** Journals hub AI-assistant card — a journal you can talk to. */
  journalsAi: require('./journals-ai.webp') as ImageSourcePropType,
  /** Journal channel first-visit — a fresh page and growth. */
  journalEmpty: require('./journal-empty.webp') as ImageSourcePropType,
  /** Landing: frame 0 of assets/lottie/study-discussion.json on a transparent 1200² canvas
   * (same geometry as the animation) — the reduced-motion / route-exit still. Re-render
   * it if the Lottie is re-themed. */
  landingStill: require('./landing-scene-still.webp') as ImageSourcePropType,
  /** Role fork: the companions at play. The still is the poster + the reduced-motion
   * picture; the film itself is ./playground-loop.mp4 (780×586, H.264, 30 fps, 19.1 s,
   * NO audio stream, an eased forward-then-back loop so plain looping is seamless; ground
   * pinned to the oat colour). Source: Higgsfield still → seedance_2_0_mini (session 35).
   * Played by components/art/PlaygroundLoop(.web). */
  playgroundStill: require('./playground-still.webp') as ImageSourcePropType,
};

export type SceneName = keyof typeof SCENES;

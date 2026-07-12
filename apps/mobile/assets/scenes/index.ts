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
};

export type SceneName = keyof typeof SCENES;

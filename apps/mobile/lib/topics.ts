/**
 * The six "What is it about" chips (board A24), shared by the New chat sheet and the
 * Personal request composer. `slug` travels as `issue_category` and is what the chat
 * header's topic chip is fed from (`issue_category_label`, worded by the server).
 *
 * Four map onto the server's slugs (services/api/app/services/categories.py). Two have no
 * slug there yet — `feeling_stuck`, `motivation`: their own slug is sent and stored (the
 * server keeps `issue_category` as free text), and their header chip appears once
 * ISSUE_CATEGORIES names them. No client change is needed then.
 */
import type { TKey } from '@/lib/i18n';

export const TOPICS: { slug: string; label: TKey }[] = [
  { slug: 'feeling_stuck', label: 'newChat.topicStuck' },
  { slug: 'exam_stress', label: 'newChat.topicExam' },
  { slug: 'motivation', label: 'newChat.topicMotivation' },
  { slug: 'family', label: 'newChat.topicFamily' },
  { slug: 'loneliness', label: 'newChat.topicLoneliness' },
  { slug: 'life', label: 'newChat.topicTalk' },
];

export function topicLabelKey(slug: string): TKey | null {
  return TOPICS.find((t) => t.slug === slug)?.label ?? null;
}

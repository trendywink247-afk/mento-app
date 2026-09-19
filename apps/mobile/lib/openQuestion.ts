/**
 * One open question at a time (server: services/api/app/services/open_question.py).
 *
 * While a Personal question waits on a mentor the member is not in touch with, the server
 * refuses a new ask to a stranger — "Next available" and a question to another mentor —
 * with a calm 409 `question_open` that names the waiting mentor. This reads that refusal
 * into what the screens need to say it (components/OpenQuestionNote.tsx) and to reopen the
 * letter (board A04, app/request-sent/[id].tsx).
 */
import { ApiError } from '@/lib/api';

export type OpenQuestion = {
  requestId: string;
  listenerId: string;
  name: string;
  avatar: string;
};

export function openQuestionFrom(e: unknown): OpenQuestion | null {
  if (!(e instanceof ApiError) || e.status !== 409 || e.code !== 'question_open') return null;
  const b = e.body ?? {};
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const requestId = str(b.request_id);
  if (!requestId) return null;
  return {
    requestId,
    listenerId: str(b.listener_id),
    name: str(b.mentor_name),
    avatar: str(b.mentor_avatar),
  };
}

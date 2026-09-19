import { MentorPathFlow } from '@/components/mentorPath/MentorPathFlow';

/** Public mentor-recruitment page (board A38, `/apply` on the web app) — no app, no
 * session needed. The same ONE mentor path as inside the app (lib/mentorPath.ts): the story,
 * then — for a visitor with no session — the server-side age gate (it mints the anonymous
 * session via the unchanged onboarding/start), the primer, the application, In review. A
 * visitor who already has a session in this browser skips the age gate and lands where
 * their application stands. No animal art anywhere on this surface (founder rule). */
export default function Apply() {
  return <MentorPathFlow surface="public" />;
}

import { MentorPathFlow } from '@/components/mentorPath/MentorPathFlow';

/** Become a mentor, inside the app — the ONE mentor path (lib/mentorPath.ts,
 * components/mentorPath/MentorPathFlow.tsx). Profile's mentor row, the role fork's mentor
 * branch, Mentor Home for someone not approved yet, and old links / notifications all land
 * here; what shows is the server's application state (story → primer → application →
 * In review; declined; approved). The route name is kept so every old link still works. */
export default function ListenerApply() {
  return <MentorPathFlow surface="member" />;
}

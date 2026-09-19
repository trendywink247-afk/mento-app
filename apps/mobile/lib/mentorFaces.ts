/**
 * What the member side already knows about how each mentor is drawn, so a screen that opens
 * before its own fetch lands (the chat header after tapping a My Chats row, the connecting
 * orb, the A04 letter) paints the RIGHT face at once instead of a default that then swaps.
 *
 * Filled from payloads the app already reads (My Chats, Browse, a match, a profile); keyed
 * by listener id and by conversation id. Memory only, per session. The server stays the
 * source of truth (`companion_animal` / `companion_colour`, server `mentor_face.py`).
 */
export type Face = { animal: string; colour: string };

const byListener = new Map<string, Face>();
const byConversation = new Map<string, Face>();
/** The signed-in mentor's OWN face (from `/listener/me`), for Mentor Home and the mentor chat. */
let own: Face | null = null;

function valid(animal: string | null | undefined, colour: string | null | undefined): Face | null {
  return animal && colour ? { animal, colour } : null;
}

export const mentorFaces = {
  remember({
    listenerId,
    conversationId,
    animal,
    colour,
  }: {
    listenerId?: string | null;
    conversationId?: string | null;
    animal?: string | null;
    colour?: string | null;
  }): void {
    const face = valid(animal, colour);
    if (!face) return;
    if (listenerId) byListener.set(listenerId, face);
    if (conversationId) byConversation.set(conversationId, face);
  },
  forListener(id: string | null | undefined): Face | null {
    return id ? (byListener.get(id) ?? null) : null;
  },
  forConversation(id: string | null | undefined): Face | null {
    return id ? (byConversation.get(id) ?? null) : null;
  },
  setSelf(animal: string | null | undefined, colour: string | null | undefined): void {
    own = valid(animal, colour) ?? own;
  },
  self(): Face | null {
    return own;
  },
};

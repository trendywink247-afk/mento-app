/** Data behind the member chat's header card (DECISIONS §L.8): who the mentor is right
 * now, and what this member has kept from THIS conversation.
 *
 * Everything here is data the member side already has — nothing is invented:
 *   - presence + community come from `GET /conversations/{id}/mentor` (the same
 *     online/away the mentor profile shows — the mentor's own availability, kept honest
 *     server-side by the console heartbeat and the auto-away sweep). It is a snapshot,
 *     so it is re-read on focus and once a minute while the chat stays open; until the
 *     first answer arrives (or if it never does) presence is `null` — unknown, never
 *     assumed.
 *   - the saved count is the member's own mentor notes whose `meta.conversation_id`
 *     is this conversation.
 *
 * Not here, on purpose: the conversation's TOPIC (no member endpoint returns
 * `conversations.issue_category` yet) and the In touch state (§L.6–7, not built).
 */
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, type ConversationMentor, type PathTree } from '@/lib/api';
import { cachedPathTree, communityLabel } from '@/lib/communityLabel';
import { mentorFaces, type Face } from '@/lib/mentorFaces';

/** How often an open chat re-reads the mentor's presence. A polling interval, not a
 * motion duration — the mentor console's own heartbeat is 5 minutes. */
const PRESENCE_POLL_MS = 60_000;

export type ChatHeaderData = {
  /** `null` until the mentor profile has loaded (or when it could not be). */
  profile: ConversationMentor | null;
  /** What this conversation is about, in the server's member-facing words ("Exam
   * stress"); null when it was started without a topic — then there is no chip. */
  topic: string | null;
  /** The mentor's community as a member reads it ("UPSC"), when they have one. */
  community: string | null;
  /** Mentor notes this member has saved from this conversation. */
  savedCount: number;
  /** Stream message ids of those notes — the bubbles that carry the settled "Saved" chip,
   * so the chip is still there after leaving and coming back (board A05). */
  savedMessageIds: ReadonlySet<string>;
  /** Re-count after a save, so the chip follows the server rather than the tap. */
  refreshSaved: () => void;
  /** The mentor's face: the profile's once it has loaded, else what the member side
   * already knew (My Chats / the match) — null only when nothing has said yet. */
  face: Face | null;
};

export function useChatHeader(conversationId: string | undefined): ChatHeaderData {
  const [profile, setProfile] = useState<ConversationMentor | null>(null);
  // undefined = still loading (no label yet, so it never flickers from a title-cased
  // slug to the real name); null = the tree could not be read (slug fallback).
  const [tree, setTree] = useState<PathTree | null | undefined>(undefined);
  const [savedCount, setSavedCount] = useState(0);
  const [savedMessageIds, setSavedMessageIds] = useState<ReadonlySet<string>>(() => new Set());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refreshProfile = useCallback(() => {
    if (!conversationId) return;
    void api
      .mentorProfile(conversationId)
      .then((p) => {
        if (!alive.current) return;
        setProfile(p);
        mentorFaces.remember({
          listenerId: p.id,
          conversationId,
          animal: p.companion_animal,
          colour: p.companion_colour,
        });
      })
      .catch(() => {
        // Stays still: the header keeps whatever it last knew.
      });
  }, [conversationId]);

  const refreshSaved = useCallback(() => {
    if (!conversationId) return;
    void api
      .listMentorNotes()
      .then((notes) => {
        if (!alive.current) return;
        const mine = notes.filter((n) => n.meta.conversation_id === conversationId);
        setSavedCount(mine.length);
        setSavedMessageIds(
          new Set(mine.map((n) => n.meta.stream_message_id).filter((id): id is string => !!id)),
        );
      })
      .catch(() => {
        // Same: a failed count never clears a chip that was true a moment ago.
      });
  }, [conversationId]);

  useFocusEffect(
    useCallback(() => {
      refreshProfile();
      refreshSaved();
      const poll = setInterval(refreshProfile, PRESENCE_POLL_MS);
      return () => clearInterval(poll);
    }, [refreshProfile, refreshSaved]),
  );

  // The community label is polish, never a blocker — only fetched when there is a
  // community to name, and simply ignored on failure (title-cased slug instead).
  const slug = profile?.community_slug ?? null;
  useEffect(() => {
    if (!slug) return;
    void cachedPathTree()
      .then((t) => {
        if (alive.current) setTree(t);
      })
      .catch(() => {
        if (alive.current) setTree(null);
      });
  }, [slug]);

  return {
    profile,
    topic: profile?.issue_category_label ?? null,
    community: slug && tree !== undefined ? communityLabel(tree, slug) : null,
    savedCount,
    savedMessageIds,
    refreshSaved,
    face:
      profile?.companion_animal && profile.companion_colour
        ? { animal: profile.companion_animal, colour: profile.companion_colour }
        : mentorFaces.forConversation(conversationId),
  };
}

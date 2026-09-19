/** A mentor's community slug ("upsc") → the label a member reads ("UPSC").
 *
 * There is no member endpoint that lists community names, so the label is read off
 * the Pathfinder tree the app already serves (`GET /paths/tree`): the BRANCH option
 * that leads to the node holding that community's stages is the community's own name
 * ("UPSC" → q_upsc_stage). Leaf options carry a STAGE label ("Just starting out"),
 * never the community's — so they are not used. A community with no branch of its own
 * (life sits on the root) falls back to the title-cased slug.
 */
import { api, type PathTree } from '@/lib/api';

// The tree only needs fetching once per app session — cache the in-flight/resolved
// promise at module scope. Cleared on failure so a later caller can still retry.
let pathTreePromise: Promise<PathTree> | null = null;

export function cachedPathTree(): Promise<PathTree> {
  if (!pathTreePromise) {
    pathTreePromise = api.pathTree().catch((e) => {
      pathTreePromise = null;
      throw e;
    });
  }
  return pathTreePromise;
}

function titleCase(slug: string): string {
  return slug
    .split('_')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Best-effort and synchronous: pass `null` while the tree is still loading and the
 * title-cased slug is returned — a label never blocks on a second round trip. */
export function communityLabel(tree: PathTree | null, slug: string): string {
  if (tree) {
    const holder = Object.entries(tree.nodes).find(([, node]) =>
      node.options.some((opt) => opt.community === slug),
    );
    if (holder) {
      const [holderId] = holder;
      for (const node of Object.values(tree.nodes)) {
        const branch = node.options.find((opt) => opt.next === holderId);
        if (branch) return branch.label;
      }
    }
  }
  return titleCase(slug);
}

/**
 * Which road chips Browse shows. Not a fixed list: the member's own road first, then the
 * roads the listed mentors actually serve (most mentors first), then Life. Road names come
 * from the server (`GET /paths/communities`), so a new exam road needs no app release.
 * Pure, so the rules are tested without a screen.
 */
export type RoadChip = { key: string; slug: string; label: string };

const MAX_OTHER_ROADS = 2;

export function roadChips(
  names: Record<string, string>,
  mentorRoads: (string | null | undefined)[],
  mine: string | null | undefined,
): RoadChip[] {
  const counts = new Map<string, number>();
  for (const slug of mentorRoads) {
    if (slug && slug !== 'life' && names[slug]) counts.set(slug, (counts.get(slug) ?? 0) + 1);
  }
  const others = [...counts.entries()]
    .filter(([slug]) => slug !== mine)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_OTHER_ROADS)
    .map(([slug]) => slug);
  // Their own road is offered even when no mentor on it is listed yet: an empty filter says
  // so honestly, which is better than the chip vanishing.
  const roads = [...(mine && mine !== 'life' && names[mine] ? [mine] : []), ...others];
  return roads.map((slug) => ({ key: `road:${slug}`, slug, label: names[slug] }));
}

export function matchesRoad(filterKey: string, community: string | null, categories: string[]): boolean {
  if (filterKey === 'life') return community === 'life' || categories.includes('life');
  if (filterKey.startsWith('road:')) return community === filterKey.slice(5);
  return true;
}

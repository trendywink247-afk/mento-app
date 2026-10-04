/** Role-scoped cleanup; no bodies or tokens are stored in this registry. */
const clients = new Map<'member' | 'mentor', Set<() => void>>();

export function registerOwnChat(role: 'member' | 'mentor', forget: () => void): () => void {
  const group = clients.get(role) ?? new Set<() => void>();
  clients.set(role, group);
  group.add(forget);
  return () => {
    group.delete(forget);
    if (group.size === 0) clients.delete(role);
  };
}

export function forgetOwnChats(role: 'member' | 'mentor'): void {
  const group = clients.get(role);
  clients.delete(role);
  for (const forget of group ?? []) {
    try { forget(); } catch { /* Complete every identity cleanup even if one observer throws. */ }
  }
}

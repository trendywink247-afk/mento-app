/** Account-generation fencing for best-effort device registration. No bearer
 * tokens are cached. Each role has its own generation and successful owner/token.
 * Identity writes pause registration until complete; ordinary token rotation does
 * not reset the same account's registration.
 */
export type PushRole = 'member' | 'listener';
type Registered = { accountId: string; token: string };
const states: Record<PushRole, { generation: number; enabled: boolean; registered?: Registered }> = {
  member: { generation: 0, enabled: true }, listener: { generation: 0, enabled: true },
};
export function pushGeneration(role: PushRole): number { return states[role].generation; }
export function pushScopeActive(role: PushRole, generation: number): boolean {
  return states[role].enabled && states[role].generation === generation;
}
export function beginPushIdentityChange(role: PushRole): number {
  const state = states[role];
  state.generation++; state.enabled = false; state.registered = undefined;
  return state.generation;
}
export function finishPushIdentityChange(role: PushRole, generation: number): void {
  if (states[role].generation === generation) states[role].enabled = true;
}
export function pushAlreadyRegistered(role: PushRole, generation: number, accountId: string, token: string): boolean {
  const known = states[role].registered;
  return pushScopeActive(role, generation) && known?.accountId === accountId && known.token === token;
}
export function rememberPushRegistration(role: PushRole, generation: number, accountId: string, token: string): void {
  if (pushScopeActive(role, generation)) states[role].registered = { accountId, token };
}

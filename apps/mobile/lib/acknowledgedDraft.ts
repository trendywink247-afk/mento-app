/** An acknowledged send may finish after the person has started the next draft.
 * Compare exact submitted input, not trimmed text, to preserve subsequent edits.
 */
export function clearAcknowledgedDraft(current: string, submitted: string): string {
  return current === submitted ? '' : current;
}

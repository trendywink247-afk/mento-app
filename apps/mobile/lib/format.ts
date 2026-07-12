/** Tiny display formatters shared across screens. */

/** Topic/category enums come from the API as snake_case (`self_esteem`) —
 * humans see "Self-esteem". */
export function formatTopic(raw: string): string {
  const words = raw.split('_');
  const first = words[0] ?? '';
  const label = [first.charAt(0).toUpperCase() + first.slice(1), ...words.slice(1)].join('-');
  return label;
}

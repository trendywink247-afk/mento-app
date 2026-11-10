/** Build version sent as `X-App-Version` so the API can answer 426 `upgrade_required`
 * to builds below its MIN_APP_VERSION. Crisis, safety, health and Stream paths are
 * exempt server-side (services/api/app/app_version.py). Web builds send it too. */
export function withAppVersion(
  headers: Record<string, string>,
  version: string | null | undefined,
): Record<string, string> {
  return version ? { ...headers, 'X-App-Version': version } : headers;
}

/**
 * The outcome of any operation that can fail across an IPC or network
 * boundary. Errors are values rather than exceptions because they have to
 * survive structured cloning between the main and renderer processes.
 *
 * Each domain narrows `E` to its own error type — see `AssetResult`,
 * `CampaignResult`, `NetworkResult` and `SceneResult`.
 */
export type Result<T, E> =
  | { error: E; ok: false }
  | { ok: true; value: T };

/**
 * Builds a failed result. Domains wrap this in a local `failure` helper that
 * pins the error-code union, so an operation cannot report a code that does
 * not apply to it.
 */
export function fail<T, E>(error: E): Result<T, E> {
  return { error, ok: false };
}

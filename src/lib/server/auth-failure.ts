// Auth service failures must not be presented as an expired client session.
// A missing/invalid token still fails closed; no offline authorization is added.
export function authFailureStatus(error: unknown): 401 | 503 {
  const issue = error as { status?: number; code?: string; name?: string } | null;
  const status = Number(issue?.status || 0);
  if (issue?.name === "AuthRetryableFetchError" || status === 429 || status >= 500) return 503;
  if (
    status === 401 || status === 403 ||
    issue?.name === "AuthSessionMissingError" ||
    ["bad_jwt", "session_not_found", "user_not_found", "no_authorization", "unexpected_aud"].includes(String(issue?.code || ""))
  ) return 401;
  return 503;
}

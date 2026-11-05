/**
 * What a failed sign-in should say to the person at the form.
 *
 * Better Auth refuses two very different things with messages that both start
 * with "Invalid":
 *
 *   - `Invalid email or password` — 401, a real credential failure. The address
 *     and password genuinely do not match an account.
 *   - `Invalid origin` — 403, the cross-site guard. The request was turned away
 *     *before* the password was ever compared, because the browser's `Origin`
 *     was not in `trustedOrigins` (see `preview.ts` and `server.ts`).
 *
 * Matching on the word "invalid" collapses the two, which is worse than a vague
 * message: it tells a visitor their password is wrong when the real fault is
 * configuration, and sends whoever is debugging it — including whoever runs the
 * app — hunting for a mistyped password that was never the problem.
 *
 * So: only a genuine credential failure may be dressed up as one. Anything else
 * is passed through as the server worded it, untranslated, so the actual fault
 * stays visible.
 *
 * Dependency-free and browser-safe: both sign-in doors (the Division Console and
 * the School Portal) use it, and so does its test.
 */

/** The subset of Better Auth's client error this needs. */
export interface SignInAuthError {
  message?: string | null;
  /** HTTP status from the refusal — 401 for a credential failure. */
  status?: number | null;
}

export function signInErrorMessage(
  authError: SignInAuthError | null | undefined,
): string {
  if (!authError) return "Sign-in failed.";
  const message = (authError.message ?? "").trim();
  const credentialFailure =
    authError.status === 401 || /invalid email or password/i.test(message);
  if (credentialFailure) return "That email and password do not match an account.";
  return message || "Sign-in failed.";
}

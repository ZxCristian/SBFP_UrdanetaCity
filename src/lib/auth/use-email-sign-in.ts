import { useEffect, useState } from "react";
import { syncWorkspace } from "@/lib/sbfp-store";
import { authClient } from "./client";
import { signInErrorMessage } from "./sign-in-error";

/** "1:05" / "0:42" for the lockout countdown. */
export function formatRetryAfter(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * The behavior both sign-in screens share: submit credentials, map the error,
 * wait for the identity's workspace, and expose busy/error state. The two
 * portals keep their own visual forms and copy.
 */
export function useEmailSignIn(options: {
  /** The School Portal requires both fields before calling Better Auth. */
  requireCredentials?: boolean;
  /** Extra guidance appended to a rejected email/password pair. */
  invalidCredentialsHint?: string;
} = {}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const coolingDown = retryAfter > 0;

  // The server owns the durable cooldown; this is only its visible countdown.
  // Re-render once a second while it is running and stop as soon as it reaches
  // zero, so the form can be tried again without a reload.
  useEffect(() => {
    if (!coolingDown) return;
    const timer = window.setInterval(() => {
      setRetryAfter((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [coolingDown]);

  const signIn = async (email: string, password: string): Promise<boolean> => {
    setError("");
    if (retryAfter > 0) return false;
    if (options.requireCredentials && (!email.trim() || !password)) {
      setError("Enter the email and password the Division Office gave you.");
      return false;
    }
    setBusy(true);
    try {
      const { error: authError } = await authClient.signIn.email({ email, password });
      if (authError) {
        const failure = authError as typeof authError & {
          retryAfterSeconds?: number | null;
        };
        const wait = Math.max(0, Math.ceil(Number(failure.retryAfterSeconds ?? 0) || 0));
        if (wait > 0) {
          setRetryAfter(wait);
          setError("");
          return false;
        }
        const message = signInErrorMessage(authError);
        setError(
          message === "That email and password do not match an account." &&
            options.invalidCredentialsHint
            ? `${message} ${options.invalidCredentialsHint}`
            : message,
        );
        return false;
      }
      setRetryAfter(0);
      // Wait for this identity's workspace before handing the button back: the
      // page can then open with its data already on screen instead of flashing
      // the form again while the first read is in flight.
      await syncWorkspace(email.trim().toLowerCase(), true);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, setError, retryAfter, signIn };
}

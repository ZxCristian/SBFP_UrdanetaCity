import { useState } from "react";
import { syncWorkspace } from "@/lib/sbfp-store";
import { authClient } from "./client";
import { signInErrorMessage } from "./sign-in-error";

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

  const signIn = async (email: string, password: string): Promise<boolean> => {
    setError("");
    if (options.requireCredentials && (!email.trim() || !password)) {
      setError("Enter the email and password the Division Office gave you.");
      return false;
    }
    setBusy(true);
    try {
      const { error: authError } = await authClient.signIn.email({ email, password });
      if (authError) {
        const message = signInErrorMessage(authError);
        setError(
          message === "That email and password do not match an account." &&
            options.invalidCredentialsHint
            ? `${message} ${options.invalidCredentialsHint}`
            : message,
        );
        return false;
      }
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

  return { busy, error, setError, signIn };
}

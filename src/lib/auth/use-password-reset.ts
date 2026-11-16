import { useState } from "react";
import { resetPasswordWithToken } from "@/lib/sbfp-api";
import { MIN_PASSWORD_LENGTH } from "@/lib/sbfp-credentials";

export type PasswordResetSuccess = {
  email: string;
  role: "admin" | "teacher";
};

/** The one rule both reset forms apply before calling the server. */
export function passwordResetProblem(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters for the new password.`;
  }
  if (password !== confirm) return "The two passwords do not match.";
  return null;
}

/**
 * The behavior both "choose a new password" screens share. The caller keeps its
 * own form, success screen and destination copy.
 */
export function usePasswordReset(
  token: string,
  options: { unexpectedError?: string } = {},
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (
    password: string,
    confirm: string,
  ): Promise<PasswordResetSuccess | null> => {
    setError("");
    const problem = passwordResetProblem(password, confirm);
    if (problem) {
      setError(problem);
      return null;
    }
    setBusy(true);
    try {
      const result = await resetPasswordWithToken({ data: { token, password } });
      if (!result.ok) {
        setError(result.message);
        return null;
      }
      return { email: result.email, role: result.role };
    } catch (err) {
      setError(
        options.unexpectedError ??
          (err instanceof Error && err.message
            ? err.message
            : "That reset link is invalid or has expired. Request a new one."),
      );
      return null;
    } finally {
      setBusy(false);
    }
  };

  return { busy, error, setError, submit };
}

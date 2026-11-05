import { useEffect } from "react";

/**
 * Query keys that must never appear in a URL. A native form submission (before
 * hydration, or with JavaScript off) used to append them, so an old link,
 * bookmark or history entry can still carry an email and a password.
 */
const CREDENTIAL_PARAM = /^(e-?mail|password|pass|pwd|username)$/i;

/**
 * Drops any credential parameter from the address bar and from the current
 * history entry when a sign-in screen mounts. The page still renders normally —
 * the values are simply never read, kept or re-shown.
 */
export function useStripCredentialQuery(): void {
  useEffect(() => {
    const url = new URL(window.location.href);
    let dirty = false;
    for (const key of [...url.searchParams.keys()]) {
      if (CREDENTIAL_PARAM.test(key)) {
        url.searchParams.delete(key);
        dirty = true;
      }
    }
    if (!dirty) return;
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);
}

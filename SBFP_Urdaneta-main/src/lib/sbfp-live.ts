/**
 * Live updates — the two sites stay in step with the database without a reload.
 *
 * A teacher saving a learner record, a school sending feedback, the Division
 * Office replying or putting an account on hold: the other side sees it a few
 * seconds later, without anyone pressing refresh.
 *
 * How: the workspace load returns a **version** — one string built from row
 * counts and newest `updated_at` timestamps for exactly the rows the caller may
 * see (see `dataVersion` in `sbfp-accounts.ts`). A visible tab asks for that
 * string every few seconds; only when it differs does it re-read the workspace.
 * That keeps the poll to one small query instead of re-fetching every learner
 * record on every tick.
 *
 * Why polling rather than a websocket: the app is deployed to serverless
 * hosting, where an in-process event bus or a LISTEN/NOTIFY connection only
 * reaches the instance that happened to handle the write. A tiny read is the
 * one approach that is correct on every instance, survives sleep, and needs no
 * extra key, table or publication.
 *
 * Polling pauses in a hidden tab and catches up immediately on focus, so a
 * teacher who leaves the portal open overnight does not query all night and
 * still sees fresh data the moment she comes back.
 */
import { fetchDataVersion } from "./sbfp-api";

/** How often a visible tab asks whether anything changed. */
const POLL_VISIBLE_MS = 6000;
/** A hidden tab only checks this often (and immediately on focus). */
const POLL_HIDDEN_MS = 30_000;

/**
 * Watch the caller's data until the returned cleanup runs.
 *
 * `getVersion` reads the version of the workspace currently on screen, and
 * `refresh` re-reads it. The next poll is only scheduled after the previous
 * check finished, so a slow connection never stacks requests.
 */
export function watchWorkspace(
  getVersion: () => string,
  refresh: () => Promise<void>,
): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return () => {};
  }

  let stopped = false;
  let inFlight = false;
  let timer: number | undefined;
  /** The version whose rows are on screen; the next change refreshes. */
  let seen = getVersion();

  const delay = () =>
    document.visibilityState === "visible" ? POLL_VISIBLE_MS : POLL_HIDDEN_MS;

  const schedule = () => {
    if (stopped) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(check, delay());
  };

  async function check(): Promise<void> {
    if (stopped || inFlight || document.visibilityState !== "visible") {
      schedule();
      return;
    }
    inFlight = true;
    try {
      const result = await fetchDataVersion();
      if (stopped) return;
      const version = result.version;
      if (version && version !== seen) {
        await refresh();
        if (stopped) return;
        // Only advance once the workspace on screen really carries this
        // version: a failed refresh leaves `seen` alone and the next poll
        // retries instead of silently skipping the change.
        const fresh = getVersion();
        seen = fresh || version;
      }
    } catch {
      // Offline or a server hiccup: keep showing the current data and retry on
      // the next tick. This must never surface as an error in the page.
    } finally {
      inFlight = false;
      schedule();
    }
  }

  const onVisible = () => {
    if (document.visibilityState === "visible") {
      window.clearTimeout(timer);
      void check();
    } else {
      schedule();
    }
  };

  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  schedule();

  return () => {
    stopped = true;
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
  };
}

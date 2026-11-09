/**
 * Which product the signed-in visitor gets.
 *
 * Both sites need the same three-way answer — is the session still resolving, is
 * this person signed in at all, and does the email hold a School Portal account,
 * the Division Office account, or nothing yet — so it is decided in one place
 * instead of being re-derived (and re-got-wrong) on each page.
 *
 * The rules the auth skill sets out are kept here: nothing is shown for a
 * *pending* session (no sign-in form flashing at someone who is already signed
 * in), and a signed-out visitor is only reported once the session has resolved.
 * `syncWorkspace()` is driven from this hook, so the two sites cannot end up
 * reading the workspace for different identities.
 */
import { useEffect, useState } from "react";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import type { AppUser } from "@/lib/auth/use-current-user";
import {
  resetWorkspace,
  syncWorkspace,
  teacherStoreSnapshot,
  useTeacherStore,
} from "./sbfp-store";
import { watchWorkspace } from "./sbfp-live";
import type { SbfpAccount, TeacherStoreState } from "./sbfp-store";

export type AccessStatus =
  /** The session, or the first workspace read, is still resolving. */
  | "loading"
  /** Nobody is signed in — show the site's own sign-in form. */
  | "signed-out"
  /** Signed in, but this email holds no account yet. */
  | "no-account"
  /** The account exists and is on hold. */
  | "disabled"
  | "admin"
  | "teacher";

export interface Access {
  status: AccessStatus;
  user: AppUser | null;
  email: string | null;
  account: SbfpAccount | null;
  store: TeacherStoreState;
  /** Read the workspace again (after the Division Office changes something). */
  reload: () => void;
  /** Forget the workspace and sign out of this app's session. */
  forget: () => void;
}

export function useAccess(): Access {
  const { user, isPending } = useCurrentUserState();
  const store = useTeacherStore();
  const email = user?.primaryEmail?.toLowerCase() ?? null;
  /** The boot read finished — its answer already names the visitor. */
  const [bootRead, setBootRead] = useState(false);

  // Ask for the workspace immediately instead of waiting for `useSession()`.
  // The workspace request verifies the same session on the server, so the
  // separate get-session round trip is no longer on the critical path: the page
  // opens on the workspace's answer, and the session hook only confirms it.
  useEffect(() => {
    let live = true;
    void syncWorkspace().finally(() => {
      if (live) setBootRead(true);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (isPending) return;
    if (!email) {
      resetWorkspace();
      return;
    }
    void syncWorkspace(email);
  }, [isPending, email]);

  // Stay live: a record saved by a school reaches the Division Office, and a
  // reply reaches the school, without either side reloading. The watcher polls
  // a tiny change signature and only re-reads the workspace when it differs.
  useEffect(() => {
    if (isPending || !email) return;
    return watchWorkspace(
      () => teacherStoreSnapshot().version,
      () => syncWorkspace(email, true),
    );
  }, [isPending, email]);

  // The workspace counts as loaded once a read has *attempted* the identity, so
  // a failed read lands on a real state (with `store.syncError` explaining it)
  // instead of spinning forever. While the session hook is still pending, the
  // boot read's answer is authoritative — it authenticated that same session.
  //
  // A resolved signed-out session needs no workspace at all: show the sign-in
  // page as soon as it lands, instead of waiting for the boot read's 401.
  const signedOut = !isPending && !email;
  // A first read for a newly signed-in identity must not briefly report "no
  // account" before the workspace arrives: `syncing` with no account yet is
  // still loading. A refresh of an already-loaded account keeps its status.
  const awaitingFirstRead = store.syncing && store.account === null;
  const loaded =
    signedOut ||
    (store.hydrated &&
      !awaitingFirstRead &&
      (isPending ? bootRead : store.email === email));
  const account = store.account;
  /** Whose answer this render is based on — the boot read while pending. */
  const identityEmail = isPending ? store.email : email;

  const status: AccessStatus = !loaded
    ? "loading"
    : !identityEmail
      ? "signed-out"
      : !account
        ? "no-account"
        : account.status !== "active"
          ? "disabled"
          : account.role === "admin"
            ? "admin"
            : "teacher";

  return {
    status,
    user,
    email,
    account,
    store,
    reload: () => void syncWorkspace(email ?? store.email, true),
    forget: resetWorkspace,
  };
}

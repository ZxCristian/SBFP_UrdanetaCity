/**
 * The district console — `/`.
 *
 * The Division Office's own product, and the only page that issues School
 * Portal accounts, so it is closed: a signed-out visitor is sent to the sign-in
 * page, and a teacher is sent to her own site instead of being shown a console
 * she has no account for.
 *
 * The sign-in form is the FIRST paint. This route renders the sign-in screen
 * itself while the session and workspace are read, so the form is already in
 * the server's HTML response instead of a blank shell waiting for the client
 * bundle to redirect. Once the session resolves, an administrator's console
 * takes over, and a teacher is sent to her own site. That trades a brief
 * sign-in flash on a signed-in reload for never making a signed-out visitor
 * wait behind a loading screen.
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import SbfpApp from "@/sbfp-app";
import { useAccess } from "@/lib/use-access";
import { LoginScreen } from "./login";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const access = useAccess();

  if (access.status === "admin") return <SbfpApp />;
  if (access.status === "teacher") return <Navigate to="/SchoolPortal" />;
  return <LoginScreen access={access} />;
}

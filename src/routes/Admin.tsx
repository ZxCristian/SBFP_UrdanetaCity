/**
 * The Division Office console — `/Admin`.
 *
 * The Division Office's own product, and the only page that issues School
 * Portal accounts, so it is closed: a signed-out visitor is sent to the sign-in
 * form, and a teacher is sent to the main School Portal instead of being shown
 * a console she has no account for.
 *
 * The sign-in form is the FIRST paint. This route renders the sign-in screen
 * itself while the session and workspace are read, so the form is already in
 * the server's HTML response instead of a blank shell waiting for the client
 * bundle to redirect. Once the session resolves, an administrator's console
 * takes over, and a teacher is sent to `/`.
 */
import { createFileRoute, Navigate } from "@tanstack/react-router";
import SbfpApp from "@/sbfp-app";
import { useAccess } from "@/lib/use-access";
import { LoginScreen } from "./login";

export const Route = createFileRoute("/Admin")({
  component: Admin,
  head: () => ({
    meta: [
      { title: "SBFP Division Console · Urdaneta City Schools" },
      {
        name: "description",
        content:
          "Division Office desk for the School-Based Feeding Program: the master list, Summary Tables, analytics, school accounts and feedback.",
      },
    ],
  }),
});

function Admin() {
  const access = useAccess();

  if (access.status === "admin") return <SbfpApp />;
  if (access.status === "teacher") return <Navigate to="/" />;
  return <LoginScreen access={access} />;
}

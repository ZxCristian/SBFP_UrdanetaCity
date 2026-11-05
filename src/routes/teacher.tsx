import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The School Portal used to live at `/teacher`. Keep the old address working —
 * bookmarks and password-reset links that already went out still point here —
 * and send visitors to the canonical `/SchoolPortal`, carrying `?reset=<token>`.
 */
export const Route = createFileRoute("/teacher")({
  validateSearch: (search: Record<string, unknown>): { reset?: string } =>
    typeof search.reset === "string" && search.reset ? { reset: search.reset } : {},
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/SchoolPortal",
      search: search.reset ? { reset: search.reset } : {},
      replace: true,
    });
  },
});

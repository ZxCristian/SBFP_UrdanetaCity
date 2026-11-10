import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * The School Portal is now the main website at `/`.
 *
 * Keep the old address working — bookmarks and password-reset links that
 * already went out still point here — and send visitors to `/`, carrying
 * `?reset=<token>`.
 */
export const Route = createFileRoute("/SchoolPortal")({
  validateSearch: (search: Record<string, unknown>): { reset?: string } =>
    typeof search.reset === "string" && search.reset ? { reset: search.reset } : {},
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/",
      search: search.reset ? { reset: search.reset } : {},
      replace: true,
    });
  },
});

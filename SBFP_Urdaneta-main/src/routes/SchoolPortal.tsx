import { createFileRoute } from "@tanstack/react-router";
import TeacherApp from "@/teacher-app";

/**
 * The School Portal — `/SchoolPortal`.
 *
 * `?reset=<token>` is the address the School Portal password-reset email
 * carries, so a school account gets its own warm portal theme instead of the
 * Division Office's console sign-in page.
 */
export interface SchoolPortalSearch {
  reset?: string;
}

export const Route = createFileRoute("/SchoolPortal")({
  component: SchoolPortal,
  validateSearch: (search: Record<string, unknown>): SchoolPortalSearch =>
    typeof search.reset === "string" && search.reset ? { reset: search.reset } : {},
  head: () => ({
    meta: [
      { title: "SBFP School Portal · Urdaneta City Schools" },
      {
        name: "description",
        content:
          "School desk for the School-Based Feeding Program: register your school, keep its SBFP profile, encode learner measurements, and send feedback to the district office.",
      },
    ],
  }),
});

function SchoolPortal() {
  const { reset } = Route.useSearch();
  return <TeacherApp resetToken={reset} />;
}

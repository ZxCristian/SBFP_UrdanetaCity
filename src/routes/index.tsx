/**
 * The School Portal — `/`, the division website's main page.
 *
 * This is the door every school uses: one account per school, the school's
 * information block, learner records, Form 1/Form 2 exports and feedback to the
 * Division Office. The Division Office's own console now lives at `/Admin`.
 *
 * `?reset=<token>` is the address the School Portal password-reset email
 * carries, so a school account gets its own warm portal theme instead of the
 * Division Office's console sign-in page.
 */
import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import TeacherApp from "@/teacher-app";
import { prewarmExcelExport } from "@/lib/prewarm-export";

export interface HomeSearch {
  reset?: string;
}

export const Route = createFileRoute("/")({
  component: Home,
  validateSearch: (search: Record<string, unknown>): HomeSearch =>
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

function Home() {
  const { reset } = Route.useSearch();
  // Form 1/Form 2 exports share the Excel chunk — warm it while the portal idles.
  useEffect(prewarmExcelExport, []);
  return <TeacherApp resetToken={reset} />;
}

import { createFileRoute } from "@tanstack/react-router";

/**
 * One-off maintenance endpoint for the disposable load-test school.
 *
 * Deploy-time migrations are skipped when the build environment has no
 * database URL, so this endpoint performs the same guarded cleanup through the
 * app's runtime connection. It is admin-only and only ever touches the school
 * whose id and name are both the test school's.
 *
 * This file is temporary and is removed after the cleanup runs.
 */
export const Route = createFileRoute("/api/maintenance/cleanup-load-test")({
  server: {
    handlers: {
      POST: async () => {
        const { assertSameSiteRequest } = await import("@/lib/auth/isolation.server");
        assertSameSiteRequest();

        const { requireUser } = await import("@/lib/auth/verify.server");
        const user = await requireUser();
        const email = user.email?.toLowerCase() ?? "";

        const { getSql } = await import("@/lib/db");
        const sql = await getSql();
        const account = await sql<{ role: string; status: string }>`
          select role, status from sbfp_accounts
          where lower(email) = ${email}
          limit 1
        `;
        if (!account[0] || account[0].role !== "admin" || account[0].status !== "active") {
          return new Response("Forbidden", { status: 403 });
        }

        const testSchool = await sql<{ id: string }>`
          select id from sbfp_schools
          where id = 'es46' and name = 'ZZ SBFP Load Test'
        `;
        if (!testSchool[0]) {
          return Response.json({ ok: true, removed: false });
        }

        await sql`delete from sbfp_feedback where school_id = 'es46'`;
        await sql`delete from sbfp_records where school_id = 'es46'`;
        await sql`delete from sbfp_summary_extras where school_id = 'es46'`;
        await sql`delete from sbfp_school_profiles_archive where school_id = 'es46'`;
        await sql`delete from sbfp_school_profiles where school_id = 'es46'`;
        await sql`delete from sbfp_accounts where school_id = 'es46'`;
        await sql`delete from sbfp_schools where id = 'es46'`;

        return Response.json({ ok: true, removed: true });
      },
    },
  },
});

/**
 * The SBFP domain layer, shared by the district console (`/`) and the School
 * Portal (`/SchoolPortal`).
 *
 * Both sites work on the same things — the 58 Urdaneta City schools, the SBFP
 * form header, learner records with WHO 2007 BMI/HFA classification, and the
 * feedback a school sends up — so the definitions live in one module.
 *
 * They live in `@/lib/sbfp-domain` rather than in `@/sbfp-app` (the console),
 * so importing `PERIODS` or `classifyBMI` on the teacher site does not pull the
 * whole district console into the teacher route's bundle. This module stays as
 * the stable import point the portal uses.
 */
export * from "./sbfp-domain";

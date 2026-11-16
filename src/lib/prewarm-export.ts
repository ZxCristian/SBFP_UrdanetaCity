/**
 * Warm the Excel-export chunk while the app sits idle.
 *
 * `@/lib/sbfp-export` (ExcelJS) is code-split to keep it off the boot path,
 * which means the first "Export to Excel" click used to download ~1MB before
 * anything happened. Prefetching it when the browser is idle moves that cost
 * off the user's click; browsers that never export simply never pay it beyond
 * the idle fetch.
 */
export function prewarmExcelExport(): void {
  if (typeof window === "undefined") return;
  const kick = () => void import("@/lib/sbfp-export").catch(() => undefined);
  window.requestIdleCallback(kick, { timeout: 10_000 });
}

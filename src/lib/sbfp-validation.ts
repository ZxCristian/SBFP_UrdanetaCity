/**
 * Learner-record checks, shared by both forms and the server.
 *
 * The district console and the school portal both encode learner records, and
 * the server saves whatever they send. A record with 0 kg and 0 cm used to be
 * accepted end to end — it counted as a learner in the district totals while
 * carrying no BMI/HFA classification. The same function is used in all three
 * places so the form and the database cannot disagree about what is valid.
 *
 * Plain values in, a sentence out: no framework, no `Student` import, so the
 * server can call it without dragging the console into its bundle.
 */

/** A record may not carry a measurement outside this range. */
const MAX_WEIGHT_KG = 300;
const MAX_HEIGHT_CM = 250;

/** The fields a record must have before it is worth saving. */
export interface LearnerFields {
  name?: string;
  period?: string;
  weight?: string;
  height?: string;
}

function numberIn(value: string | undefined, min: number, max: number): number | null {
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

/**
 * Why this record cannot be saved, or null when it can.
 *
 * Weight and height are required: an SBFP record without them has no BMI and no
 * nutritional status, so it is not a record the district can report on. The
 * upper bounds catch a slipped decimal point (2450 cm) as well as zero.
 */
export function learnerProblem(record: LearnerFields): string | null {
  if (!String(record.name ?? "").trim()) {
    return "Enter the learner's name.";
  }
  if (!String(record.period ?? "").trim()) {
    return "Choose the measurement period (Baseline, Midline or Endline).";
  }
  if (!String(record.weight ?? "").trim()) {
    return "Enter the learner's weight in kilograms.";
  }
  if (!String(record.height ?? "").trim()) {
    return "Enter the learner's height in centimetres.";
  }
  if (numberIn(record.weight, 0.1, MAX_WEIGHT_KG) === null) {
    return `Weight must be between 0.1 and ${MAX_WEIGHT_KG} kg.`;
  }
  if (numberIn(record.height, 1, MAX_HEIGHT_CM) === null) {
    return `Height must be between 1 and ${MAX_HEIGHT_CM} cm.`;
  }
  return null;
}

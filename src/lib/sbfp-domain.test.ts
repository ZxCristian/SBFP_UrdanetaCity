import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPTY_STUDENT,
  classifyBeneficiary,
  getGrades,
  isSpedSchool,
  tallyRecords,
  type School,
} from "./sbfp-domain.ts";

describe("classifyBeneficiary", () => {
  it("makes wasted and severely wasted learners Primary from Grade 2", () => {
    assert.equal(classifyBeneficiary("Grade 2", "Wasted", "Normal"), "Primary");
    assert.equal(classifyBeneficiary("Grade 6", "Severely Wasted", "Normal"), "Primary");
  });

  it("makes stunted and severely stunted learners Secondary when not wasted", () => {
    assert.equal(classifyBeneficiary("Grade 3", "Normal", "Stunted"), "Secondary");
    assert.equal(classifyBeneficiary("Grade 10", "Normal", "Severely Stunted"), "Secondary");
  });

  it("keeps the wasted status as Primary when a learner is both wasted and stunted", () => {
    assert.equal(classifyBeneficiary("Grade 4", "Wasted", "Severely Stunted"), "Primary");
    assert.equal(classifyBeneficiary("Grade 5", "Severely Wasted", "Stunted"), "Primary");
  });

  it("keeps Kinder and Grade 1 Primary regardless of status", () => {
    assert.equal(classifyBeneficiary("Kinder", "Normal", "Severely Stunted"), "Primary");
    assert.equal(classifyBeneficiary("Grade 1", "", ""), "Primary");
    assert.equal(classifyBeneficiary("SPED Kinder", "Normal", "Stunted"), "Primary");
  });

  it("applies the same rule to SPED Grade 2–6", () => {
    assert.equal(classifyBeneficiary("SPED Grade 3", "Wasted", "Normal"), "Primary");
    assert.equal(classifyBeneficiary("SPED Grade 4", "Normal", "Stunted"), "Secondary");
  });

  it("leaves learners without a stunting or wasting status unclassified", () => {
    assert.equal(classifyBeneficiary("Grade 2", "Normal", "Normal"), "");
    assert.equal(classifyBeneficiary("Grade 2", "", ""), "");
  });
});

describe("isSpedSchool", () => {
  it("uses the stable seeded id, not the school name", () => {
    assert.equal(isSpedSchool({ id: "es44" }), true);
    assert.equal(isSpedSchool({ id: "es01" }), false);
    assert.equal(isSpedSchool(undefined), false);
    assert.ok(getGrades({ id: "es44", name: "Renamed Central", type: "Elementary" } as School).includes("SPED Kinder"));
  });
});

describe("tallyRecords", () => {
  const rows = [
    { ...EMPTY_STUDENT("es44", "Baseline"), id: "a", name: "A", sex: "M", gradeLevel: "Grade 1", bmiStatus: "Wasted", hfaStatus: "Normal", dewormed: "Yes", fourPs: "Yes" },
    { ...EMPTY_STUDENT("es44", "Baseline"), id: "b", name: "B", sex: "F", gradeLevel: "Grade 2", bmiStatus: "Normal", hfaStatus: "Stunted", hasYoungChildren: "Yes" },
  ] as const;

  it("counts one grade/sex cohort in a single pass", () => {
    const gradeOne = tallyRecords(rows, "Grade 1", null, (grade, rowGrade) => grade === rowGrade);
    assert.equal(gradeOne.learners, 1);
    assert.equal(gradeOne.bmi[1], 1);
    assert.equal(gradeOne.dewormed, 1);
    assert.equal(gradeOne.fourPs, 1);

    const all = tallyRecords(rows, null, null, (grade, rowGrade) => grade === rowGrade);
    assert.equal(all.learners, 2);
    assert.equal(all.hfa[1], 1);
    assert.equal(all.pregnantYoung, 1);
  });
});

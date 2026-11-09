import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyBeneficiary } from "./sbfp-domain.ts";

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

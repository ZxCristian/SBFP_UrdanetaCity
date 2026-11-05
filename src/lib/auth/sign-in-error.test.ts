import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signInErrorMessage } from "./sign-in-error.ts";

const WRONG_PASSWORD = "That email and password do not match an account.";

describe("signInErrorMessage", () => {
  it("reports a real credential failure as a wrong password", () => {
    assert.equal(
      signInErrorMessage({ message: "Invalid email or password", status: 401 }),
      WRONG_PASSWORD,
    );
    // The status alone is enough — the wording is Better Auth's to change.
    assert.equal(signInErrorMessage({ status: 401 }), WRONG_PASSWORD);
    assert.equal(
      signInErrorMessage({ message: "invalid email or password" }),
      WRONG_PASSWORD,
    );
  });

  it("never disguises a rejected origin as a wrong password", () => {
    // The bug this exists for: "Invalid origin" is the cross-site guard turning
    // the request away before the password is compared. A substring match on
    // "invalid" reported it as bad credentials.
    assert.equal(signInErrorMessage({ message: "Invalid origin", status: 403 }), "Invalid origin");
    assert.notEqual(
      signInErrorMessage({ message: "Invalid origin", status: 403 }),
      WRONG_PASSWORD,
    );
  });

  it("passes any other refusal through in the server's own words", () => {
    assert.equal(
      signInErrorMessage({ message: "Email not verified", status: 403 }),
      "Email not verified",
    );
    assert.equal(signInErrorMessage({ message: "Too many requests", status: 429 }), "Too many requests");
  });

  it("falls back when there is nothing to say", () => {
    assert.equal(signInErrorMessage(null), "Sign-in failed.");
    assert.equal(signInErrorMessage({}), "Sign-in failed.");
    assert.equal(signInErrorMessage({ message: "   " }), "Sign-in failed.");
  });
});

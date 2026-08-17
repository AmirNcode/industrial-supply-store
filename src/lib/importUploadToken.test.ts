import assert from "node:assert/strict";
import { test } from "node:test";
import { signImportUploadClaim, verifyImportUploadClaim } from "./importUploadToken";

const SECRET = "test-secret-at-least-sixteen-characters";
const CLAIM = {
  familyId: 42,
  path: "imports/2026-08-17_123e4567-e89b-42d3-a456-426614174000.csv",
  bytes: 12_345,
  expiresAt: 2_000_000,
};

test("an import upload claim round-trips only for its signer and lifetime", () => {
  const token = signImportUploadClaim(CLAIM, SECRET);
  assert.deepEqual(verifyImportUploadClaim(token, SECRET, 1_000_000), CLAIM);
  assert.equal(verifyImportUploadClaim(token, "another-secret-at-least-sixteen", 1_000_000), null);
  assert.equal(verifyImportUploadClaim(token, SECRET, CLAIM.expiresAt), null);
});

test("tampered import metadata and paths are refused", () => {
  const token = signImportUploadClaim(CLAIM, SECRET);
  assert.equal(verifyImportUploadClaim(`${token}x`, SECRET, 1_000_000), null);
  assert.equal(
    verifyImportUploadClaim(
      signImportUploadClaim({ ...CLAIM, path: "../catalog-images/private.csv" }, SECRET),
      SECRET,
      1_000_000,
    ),
    null,
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { PROOF_MAX_BYTES, proofProblem, sniffProofType } from "./paymentProof";

const bytes = (...values: (number | string)[]) =>
  new Uint8Array(values.flatMap((v) => (typeof v === "string" ? [...v].map((c) => c.charCodeAt(0)) : [v])));

test("a receipt is recognised by its contents", () => {
  assert.equal(sniffProofType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0)), "image/jpeg");
  assert.equal(sniffProofType(bytes(0x89, "PNG", 0x0d, 0x0a, 0x1a, 0x0a, 0)), "image/png");
  assert.equal(sniffProofType(bytes("RIFF", 0, 0, 0, 0, "WEBPVP8 ")), "image/webp");
  assert.equal(sniffProofType(bytes("%PDF-1.7\n")), "application/pdf");
});

test("anything else is refused, whatever it is called", () => {
  assert.equal(sniffProofType(bytes("<svg xmlns=")), null);
  assert.equal(sniffProofType(bytes("<!doctype html>")), null);
  assert.equal(sniffProofType(bytes("GIF89a")), null);
  assert.equal(sniffProofType(bytes("RIFF", 0, 0, 0, 0, "WAVE")), null);
  assert.equal(proofProblem(bytes("<html>")), "bad-type");
});

test("empty and oversized files are named as such", () => {
  assert.equal(proofProblem(new Uint8Array()), "empty");
  const big = new Uint8Array(PROOF_MAX_BYTES + 1);
  big.set([0xff, 0xd8, 0xff]);
  assert.equal(proofProblem(big), "too-large");
  assert.equal(proofProblem(bytes(0xff, 0xd8, 0xff, 0xdb)), null);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { csvFileForUpload } from "./importUploadClient";

test("CSV upload preserves bytes and normalizes spreadsheet MIME types", async () => {
  const source = new File(["part_number,price_usd\nNEW-1,12.50\n"], "shelf.csv", {
    type: "application/vnd.ms-excel",
    lastModified: 1234,
  });

  const upload = csvFileForUpload(source);
  assert.notEqual(upload, source);
  assert.equal(upload.name, source.name);
  assert.equal(upload.lastModified, source.lastModified);
  assert.equal(upload.type, "text/csv");
  assert.equal(upload.size, source.size);
  assert.equal(await upload.text(), await source.text());
});

test("a text/csv File is reused without another wrapper", () => {
  const source = new File(["part_number\nNEW-1\n"], "shelf.csv", { type: "text/csv" });
  assert.equal(csvFileForUpload(source), source);
});

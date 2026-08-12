import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG_IMAGE_MAX_BYTES,
  catalogImageFileProblem,
  normalizeCatalogImageUrl,
} from "./catalogImages";

test("catalog image URLs allow only normal web URLs", () => {
  assert.equal(normalizeCatalogImageUrl(" https://img.example/valve a.webp "), "https://img.example/valve%20a.webp");
  assert.equal(normalizeCatalogImageUrl("http://img.example/a.png"), "http://img.example/a.png");
  assert.equal(normalizeCatalogImageUrl("javascript:alert(1)"), null);
  assert.equal(normalizeCatalogImageUrl("data:image/png;base64,AAAA"), null);
  assert.equal(normalizeCatalogImageUrl("not a url"), null);
  assert.equal(normalizeCatalogImageUrl("   "), "");
});

test("catalog image files are JPG, PNG, or WebP and no larger than 5 MB", () => {
  assert.equal(catalogImageFileProblem({ type: "image/jpeg", size: 100 }), null);
  assert.equal(catalogImageFileProblem({ type: "image/png", size: 100 }), null);
  assert.equal(catalogImageFileProblem({ type: "image/webp", size: 100 }), null);
  assert.equal(catalogImageFileProblem({ type: "image/svg+xml", size: 100 }), "file-type");
  assert.equal(
    catalogImageFileProblem({ type: "image/png", size: CATALOG_IMAGE_MAX_BYTES + 1 }),
    "file-too-large",
  );
});

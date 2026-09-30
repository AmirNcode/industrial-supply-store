import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG_IMAGE_MAX_BYTES,
  catalogImageFileProblem,
  optimizableImageUrl,
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

test("catalog image files are JPG, PNG, or WebP and no larger than 4 MB", () => {
  assert.equal(catalogImageFileProblem({ type: "image/jpeg", size: 100 }), null);
  assert.equal(catalogImageFileProblem({ type: "image/png", size: 100 }), null);
  assert.equal(catalogImageFileProblem({ type: "image/webp", size: 100 }), null);
  assert.equal(catalogImageFileProblem({ type: "image/svg+xml", size: 100 }), "file-type");
  assert.equal(
    catalogImageFileProblem({ type: "image/png", size: CATALOG_IMAGE_MAX_BYTES + 1 }),
    "file-too-large",
  );
});

test("only our own Storage goes through the image optimiser", () => {
  const upload = "https://myyjeiujwtkwlemidvow.supabase.co/storage/v1/object/public/catalog-images/a.webp";
  assert.equal(optimizableImageUrl(upload, ""), true);
  assert.equal(optimizableImageUrl("https://files.example.ir/storage/v1/object/public/catalog-images/a.webp", "files.example.ir"), true);
  // A pasted supplier image, a lookalike path elsewhere, plain http, junk.
  assert.equal(optimizableImageUrl("https://supplier.example/photos/a.jpg", ""), false);
  assert.equal(optimizableImageUrl("https://evil.example/storage/v1/object/public/x.jpg", ""), false);
  assert.equal(optimizableImageUrl("https://evil.supabase.co.example/storage/v1/object/public/x.jpg", ""), false);
  assert.equal(optimizableImageUrl("http://myyjeiujwtkwlemidvow.supabase.co/storage/v1/object/public/a.jpg", ""), false);
  assert.equal(optimizableImageUrl("https://myyjeiujwtkwlemidvow.supabase.co/rest/v1/users", ""), false);
  assert.equal(optimizableImageUrl("not a url", ""), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CALLOUT_THUMB_SIZE,
  DIAGRAM_SIZE,
  calloutArt,
  paragraphs,
} from "./catalogCallout";

test("a diagram is the picture, at diagram size", () => {
  assert.deepEqual(
    calloutArt({
      diagramUrl: "https://cdn.example/oring-wd.png",
      imageUrl: "https://cdn.example/oring-photo.jpg",
      icon: "oring",
    }),
    {
      imageUrl: "https://cdn.example/oring-wd.png",
      icon: "oring",
      size: DIAGRAM_SIZE,
      isDiagram: true,
    },
  );
});

test("the catalog image stands in, but stays a thumbnail", () => {
  const art = calloutArt({
    diagramUrl: "",
    imageUrl: "https://cdn.example/oring-photo.jpg",
    icon: "oring",
  });
  assert.equal(art.imageUrl, "https://cdn.example/oring-photo.jpg");
  assert.equal(art.isDiagram, false);
  // The size is what tells a reader this is not an explanation of a dimension.
  assert.equal(art.size, CALLOUT_THUMB_SIZE);
  assert.notEqual(art.size, DIAGRAM_SIZE);
});

test("with no picture at all the icon stands in at the same thumbnail size", () => {
  assert.deepEqual(calloutArt({ diagramUrl: "", imageUrl: "", icon: "valve" }), {
    imageUrl: "",
    icon: "valve",
    size: CALLOUT_THUMB_SIZE,
    isDiagram: false,
  });
});

test("a blank line starts a paragraph", () => {
  assert.deepEqual(paragraphs("First para.\n\nSecond para."), [
    "First para.",
    "Second para.",
  ]);
});

test("a single newline is a soft wrap, not a paragraph", () => {
  assert.deepEqual(paragraphs("A hard-wrapped\nsupplier sentence."), [
    "A hard-wrapped supplier sentence.",
  ]);
});

test("runs of blank lines and stray whitespace do not become empty paragraphs", () => {
  assert.deepEqual(paragraphs("\n\n  One.  \n\n \n\n Two. \n\n"), ["One.", "Two."]);
  assert.deepEqual(paragraphs("Trailing newline.\n"), ["Trailing newline."]);
  assert.deepEqual(paragraphs("   \n \n  "), []);
  assert.deepEqual(paragraphs(""), []);
});

test("carriage returns from a Windows paste are handled the same way", () => {
  assert.deepEqual(paragraphs("One.\r\n\r\nTwo.\r\nStill two."), [
    "One.",
    "Two. Still two.",
  ]);
});

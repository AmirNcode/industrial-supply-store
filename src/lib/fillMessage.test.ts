import { test } from "node:test";
import assert from "node:assert/strict";
import { fillMessage } from "./fillMessage";

test("values with $-sequences arrive exactly as they are", () => {
  // Every special replacement pattern String.replace would interpret.
  for (const password of ["Ab3$$x!q9Zk", "a$&b", "a$`b", "a$'b", "$1$2"]) {
    assert.equal(
      fillMessage("Sign in at {url} as {login} with {password}", {
        url: "https://temex.ir/fa/account/signin",
        login: "1234567",
        password,
      }),
      `Sign in at https://temex.ir/fa/account/signin as 1234567 with ${password}`,
    );
  }
  assert.equal(
    fillMessage("{company}: order {ref}. {url}", { company: "Pipe $$ Co", ref: "ORD-ABC234", url: "u" }),
    "Pipe $$ Co: order ORD-ABC234. u",
  );
});

test("placeholders with no value are left alone", () => {
  assert.equal(fillMessage("{a} and {b}", { a: "x" }), "x and {b}");
});

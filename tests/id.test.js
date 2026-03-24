import test from "node:test";
import assert from "node:assert/strict";

import { makeId } from "../id.js";

test("makeId uses randomUUID when available", () => {
  const id = makeId("bite", { randomUUID: () => "known-id" });

  assert.equal(id, "bite-known-id");
});

test("makeId falls back when randomUUID is unavailable", () => {
  const id = makeId("bite", {});

  assert.match(id, /^bite-[a-z0-9]{8}$/);
});

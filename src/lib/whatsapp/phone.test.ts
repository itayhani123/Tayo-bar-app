import assert from "node:assert/strict";
import test from "node:test";
import { normalizeIsraeliPhone } from "./phone.ts";

test("normalizes an Israeli mobile with leading zero", () => assert.equal(normalizeIsraeliPhone("0501234567"), "972501234567"));
test("normalizes an international Israeli mobile", () => assert.equal(normalizeIsraeliPhone("+972-50-123-4567"), "972501234567"));
test("keeps an already normalized mobile", () => assert.equal(normalizeIsraeliPhone("972501234567"), "972501234567"));
test("rejects missing and invalid phones", () => { assert.equal(normalizeIsraeliPhone(""), null); assert.equal(normalizeIsraeliPhone("031234567"), null); });

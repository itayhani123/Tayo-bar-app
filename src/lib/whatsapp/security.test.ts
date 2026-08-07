import assert from "node:assert/strict";
import test from "node:test";
import { hasValidCronAuthorization } from "./security.ts";

test("cron rejects missing authorization", () => assert.equal(hasValidCronAuthorization(null, "secret"), false));
test("cron rejects an invalid bearer secret", () => assert.equal(hasValidCronAuthorization("Bearer wrong", "secret"), false));
test("cron accepts the exact bearer secret", () => assert.equal(hasValidCronAuthorization("Bearer secret", "secret"), true));
test("cron remains closed when CRON_SECRET is missing", () => assert.equal(hasValidCronAuthorization("Bearer undefined", undefined), false));

import assert from "node:assert/strict";
import test from "node:test";
import { navigationItemsForRole } from "./navigation.ts";

test("manager mobile and desktop navigation contains only operational routes", () => assert.deepEqual(navigationItemsForRole("manager").map((item) => item.href), ["/dashboard", "/calendar", "/events", "/employees", "/timesheets"]));
test("owner navigation includes financial routes", () => { const routes = navigationItemsForRole("owner").map((item) => item.href); assert.equal(routes.includes("/receivables"), true); assert.equal(routes.includes("/payroll"), true); assert.equal(routes.includes("/settings"), true); });

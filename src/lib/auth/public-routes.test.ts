import assert from "node:assert/strict";
import test from "node:test";
import { isUnauthenticatedServerRoute } from "./public-routes.ts";

test("WhatsApp cron reaches its route handler without a user session", () => assert.equal(isUnauthenticatedServerRoute("/api/cron/whatsapp-notifications"), true));
test("WhatsApp webhook reaches its route handler without a user session", () => assert.equal(isUnauthenticatedServerRoute("/api/webhooks/whatsapp"), true));
test("normal pages remain protected", () => assert.equal(isUnauthenticatedServerRoute("/events"), false));
test("other API routes remain protected", () => { assert.equal(isUnauthenticatedServerRoute("/api/event-payments"), false); assert.equal(isUnauthenticatedServerRoute("/api/whatsapp/settings"), false); });
test("similar route names do not become public", () => { assert.equal(isUnauthenticatedServerRoute("/api/cron/whatsapp-notifications-unsafe"), false); assert.equal(isUnauthenticatedServerRoute("/api/webhooks/whatsapp-unsafe"), false); });
test("unlisted subpaths do not become public", () => assert.equal(isUnauthenticatedServerRoute("/api/webhooks/whatsapp/debug"), false));

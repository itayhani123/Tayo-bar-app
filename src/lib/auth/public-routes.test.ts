import assert from "node:assert/strict";
import test from "node:test";
import { isUnauthenticatedServerRoute } from "./public-routes.ts";

test("WhatsApp cron reaches its route handler without a user session", () => assert.equal(isUnauthenticatedServerRoute("/api/cron/whatsapp-notifications"), true));
test("WhatsApp AI worker bypasses only session authentication for its exact path", () => {
  assert.equal(isUnauthenticatedServerRoute("/api/cron/whatsapp-ai"), true);
  for (const path of ["/api/cron", "/api/cron/", "/api/cron/whatsapp-ai/", "/api/cron/whatsapp-ai/debug", "/api/cron/whatsapp-ai-unsafe", "/api/cron/whatsapp-ai-other", "/api/cron/other-worker"]) {
    assert.equal(isUnauthenticatedServerRoute(path), false, path);
  }
});
test("WhatsApp webhook reaches its route handler without a user session", () => assert.equal(isUnauthenticatedServerRoute("/api/webhooks/whatsapp"), true));
test("offline fallback is reachable without a user session", () => assert.equal(isUnauthenticatedServerRoute("/offline"), true));
test("privacy policy is public without exposing similarly named or nested routes", () => {
  assert.equal(isUnauthenticatedServerRoute("/privacy"), true);
  for (const path of ["/privacy-admin", "/privacy/internal", "/api/privacy", "/events"]) {
    assert.equal(isUnauthenticatedServerRoute(path), false);
  }
});
test("normal pages remain protected", () => assert.equal(isUnauthenticatedServerRoute("/events"), false));
test("other API routes remain protected", () => { assert.equal(isUnauthenticatedServerRoute("/api/event-payments"), false); assert.equal(isUnauthenticatedServerRoute("/api/whatsapp/settings"), false); });
test("similar route names do not become public", () => { assert.equal(isUnauthenticatedServerRoute("/api/cron/whatsapp-notifications-unsafe"), false); assert.equal(isUnauthenticatedServerRoute("/api/webhooks/whatsapp-unsafe"), false); });
test("unlisted subpaths do not become public", () => assert.equal(isUnauthenticatedServerRoute("/api/webhooks/whatsapp/debug"), false));

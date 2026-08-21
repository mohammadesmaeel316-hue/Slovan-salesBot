"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isAllowedWebhookSecret,
  isValidWebhookSecret,
} = require("../src/webhookSecurity");

test("accepts Telegram-compatible webhook secrets", () => {
  assert.equal(isAllowedWebhookSecret("safe_secret-123456"), true);
  assert.equal(isAllowedWebhookSecret("short"), false);
  assert.equal(isAllowedWebhookSecret("not allowed spaces"), false);
});

test("compares webhook secrets exactly", () => {
  assert.equal(isValidWebhookSecret("safe_secret-123456", "safe_secret-123456"), true);
  assert.equal(isValidWebhookSecret("safe_secret-123457", "safe_secret-123456"), false);
  assert.equal(isValidWebhookSecret(undefined, "safe_secret-123456"), false);
});

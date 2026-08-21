"use strict";

const crypto = require("node:crypto");

function isValidWebhookSecret(received, expected) {
  if (typeof received !== "string" || typeof expected !== "string") return false;

  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);
  return (
    receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}

function isAllowedWebhookSecret(secret) {
  return /^[A-Za-z0-9_-]{16,256}$/.test(String(secret || ""));
}

module.exports = {
  isAllowedWebhookSecret,
  isValidWebhookSecret,
};

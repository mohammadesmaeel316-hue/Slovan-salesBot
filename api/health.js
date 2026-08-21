"use strict";

require("dotenv").config();

const { testConnection, testCustomerConnection } = require("../src/db");

module.exports = async function health(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  try {
    await testConnection();
    const customerDatabase = await testCustomerConnection();
    return res.status(200).json({ ok: true, database: "ready", customerDatabase });
  } catch (error) {
    console.error("Health check failed:", error);
    return res.status(503).json({ ok: false, database: "unavailable" });
  }
};

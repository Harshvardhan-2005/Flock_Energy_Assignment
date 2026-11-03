// server.js - tiny Express app showing how to use the portal client
// npm i express
// PORTAL_EMAIL=... PORTAL_PASSWORD=... node server.js

const express = require("express");
const portal = require("./portal-client.js");
const { fetchAllMeters, fetchMeterDetails } = require("./meter-service.js");
const { fetchAllTransformers } = require("./transformers-service");

const app = express();

// Middleware: makes sure a valid portal session exists before any /api route runs
app.use("/api", async (req, res, next) => {
  try {
    if (portal.cookies.size === 0) await portal.login();
    next();
  } catch (err) {
    res
      .status(502)
      .json({ error: { code: "PORTAL_LOGIN_FAILED", message: err.message } });
  }
});

// API 1 : get all meters Done
app.get("/api/meters", async (req, res) => {
  try {
    res.json(await fetchAllMeters());
  } catch (err) {
    res
      .status(502)
      .json({ error: { code: "PORTAL_UNAVAILABLE", message: err.message } });
  }
});

// Meters matching a search query, also combined into one response: /api/meters/search?q=J1000
// (keep this above any future /api/meters/:id route so "search" isn't read as an id)
app.get("/api/meters/search", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) {
    return res.status(400).json({
      error: {
        code: "MISSING_QUERY",
        message: 'Query parameter "q" is required',
      },
    });
  }
  try {
    res.json({ query: q, ...(await fetchAllMeters(q)) });
  } catch (err) {
    res
      .status(502)
      .json({ error: { code: "PORTAL_UNAVAILABLE", message: err.message } });
  }
});

// APi 2 : get all transformers done

// All transformers in one response (combines every portal page)
app.get("/api/transformers", async (req, res) => {
  try {
    res.json(await fetchAllTransformers());
  } catch (err) {
    res
      .status(502)
      .json({ error: { code: "PORTAL_UNAVAILABLE", message: err.message } });
  }
});

// API 3 : get meter by id
// One meter's details (location + energy together): /api/meters/J100000
app.get("/api/meters/:id", async (req, res) => {
  try {
    const details = await fetchMeterDetails(req.params.id);
    if (!details) {
      return res
        .status(404)
        .json({
          error: {
            code: "METER_NOT_FOUND",
            message: `No meter ${req.params.id}`,
          },
        });
    }
    res.json(details);
  } catch (err) {
    res
      .status(502)
      .json({ error: { code: "PORTAL_UNAVAILABLE", message: err.message } });
  }
});

app.listen(3000, () => console.log("API on http://localhost:3000"));

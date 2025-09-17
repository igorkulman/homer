#!/usr/bin/env node

// Simple proxy server for production Homer deployment
// This replicates the Vite proxy functionality for production use

import express from "express";
import cors from "cors";
import process from "process";

const app = express();
const PORT = process.env.PROXY_PORT || 3001;

// Store session cookies per target domain
const sessionCookies = new Map();

// Enable CORS for all routes
app.use(cors());

// Parse JSON bodies
app.use(express.json());

// Custom proxy middleware that handles session cookies
app.use("*", async (req, res) => {
  try {
    console.log("Raw request data:", {
      path: req.path,
      originalUrl: req.originalUrl,
      url: req.url,
      method: req.method,
      headers: req.headers,
    });

    // Extract target URL from originalUrl which contains the full path
    let proxyPath = req.originalUrl;

    // Remove leading slash if present
    if (proxyPath.startsWith("/")) {
      proxyPath = proxyPath.substring(1);
    }

    // Remove /api/proxy/ prefix if present (for production with lighttpd)
    if (proxyPath.startsWith("api/proxy/")) {
      proxyPath = proxyPath.substring("api/proxy/".length);
    }

    // If the path is empty, return error
    if (!proxyPath || proxyPath === "") {
      return res.status(400).json({
        error: "No target URL provided",
        debug: {
          path: req.path,
          originalUrl: req.originalUrl,
          url: req.url,
        },
      });
    }

    let targetUrl = proxyPath.includes("%")
      ? decodeURIComponent(proxyPath)
      : proxyPath;

    // Fix malformed URLs (missing slash in https:/)
    if (targetUrl.startsWith("https:/") && !targetUrl.startsWith("https://")) {
      targetUrl = targetUrl.replace("https:/", "https://");
    }
    if (targetUrl.startsWith("http:/") && !targetUrl.startsWith("http://")) {
      targetUrl = targetUrl.replace("http:/", "http://");
    }

    console.log(`Proxying request to: ${targetUrl}`);

    // Forward headers based on patterns
    const forwardHeaders = {
      "user-agent": req.headers["user-agent"] || "Homer-Proxy/1.0",
      accept: req.headers["accept"] || "*/*",
      "content-type": req.headers["content-type"],
    };

    // Forward authorization header
    if (req.headers["authorization"]) {
      forwardHeaders["authorization"] = req.headers["authorization"];
    }

    // Forward all x- prefixed headers
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.startsWith("x-")) {
        forwardHeaders[key] = value;
      }
    }

    // Add stored session cookies for this target domain
    const targetDomain = new URL(targetUrl).host;
    const storedCookies = sessionCookies.get(targetDomain);
    if (storedCookies) {
      forwardHeaders["cookie"] = storedCookies;
      console.log(`Using stored cookies for ${targetDomain}:`, storedCookies);
    }

    // Disable SSL verification for self-signed certificates
    const originalRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

    try {
      // Prepare fetch options
      const fetchOptions = {
        method: req.method,
        headers: forwardHeaders,
      };

      // Add body for POST/PUT/PATCH requests
      if (["POST", "PUT", "PATCH"].includes(req.method) && req.body) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      // Make the request
      const response = await fetch(targetUrl, fetchOptions);

      // Capture and store session cookies from response
      const setCookieHeaders = response.headers.get("set-cookie");
      if (setCookieHeaders) {
        const cookies = Array.isArray(setCookieHeaders)
          ? setCookieHeaders.map((cookie) => cookie.split(";")[0]).join("; ")
          : setCookieHeaders
              .split(",")
              .map((cookie) => cookie.split(";")[0])
              .join("; ");
        sessionCookies.set(targetDomain, cookies);
        console.log(`Stored session cookies for ${targetDomain}:`, cookies);
      }

      // Forward response headers
      response.headers.forEach((value, key) => {
        if (
          !["content-encoding", "transfer-encoding"].includes(key.toLowerCase())
        ) {
          res.setHeader(key, value);
        }
      });

      // Set response status
      res.status(response.status);

      // Forward response body
      const responseBuffer = await response.arrayBuffer();
      res.send(Buffer.from(responseBuffer));
    } catch (fetchError) {
      console.error("Proxy error:", fetchError);
      res.status(500).json({
        error: "Proxy request failed",
        details: fetchError.message,
      });
    } finally {
      // Always restore SSL verification
      if (originalRejectUnauthorized !== undefined) {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = originalRejectUnauthorized;
      } else {
        delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      }
    }
  } catch (error) {
    console.error("General error:", error);
    res.status(500).json({
      error: "Server error",
      details: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Homer proxy server listening on port ${PORT}`);
});

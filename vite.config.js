import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "url";
import fs from "fs";
import path from "path";
import process from "process";
import { Buffer } from "buffer";

import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Generic proxy - no service-specific authentication logic needed
// Store session cookies per target domain
const sessionCookies = new Map();

// https://vitejs.dev/config/
export default defineConfig({
  base: "",
  build: {
    assetsDir: "resources",
  },
  plugins: [
    // Custom plugin to serve dummy-data JSON files without sourcemap injection
    {
      name: "dummy-data-json-handler",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith("/dummy-data/")) {
            // Remove query parameters from URL to get the actual file path
            const urlWithoutQuery = req.url.split("?")[0];
            const filePath = path.join(process.cwd(), urlWithoutQuery);

            if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
              res.end(fs.readFileSync(filePath, "utf8"));
              return;
            }
          }
          next();
        });
      },
    },
    // Proxy API to bypass CORS issues
    {
      name: "homer-proxy",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith("/api/proxy/")) {
            return next();
          }

          try {
            // Extract target URL and path from request
            const proxyPath = req.url.replace("/api/proxy/", "");
            // Handle both encoded and unencoded URLs
            const targetUrl = proxyPath.includes("%")
              ? decodeURIComponent(proxyPath)
              : proxyPath;

            // Forward headers based on patterns
            const forwardHeaders = {};

            // Headers to always forward
            const standardHeaders = [
              "authorization",
              "content-type",
              "accept",
              "user-agent",
            ];

            // Forward standard headers
            for (const header of standardHeaders) {
              if (req.headers[header]) {
                forwardHeaders[header] = req.headers[header];
              }
            }

            // Forward all x- prefixed headers (custom headers convention)
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
            }

            // The proxy is now completely generic - no service-specific logic needed
            // Services handle their own authentication and session management

            // Get request body for POST requests
            let requestBody = null;
            if (
              req.method === "POST" ||
              req.method === "PUT" ||
              req.method === "PATCH"
            ) {
              const chunks = [];
              for await (const chunk of req) {
                chunks.push(chunk);
              }
              requestBody = Buffer.concat(chunks);
            }

            // Configure fetch options for HTTPS with self-signed certificates
            const fetchOptions = {
              method: req.method,
              headers: {
                ...forwardHeaders,
                "User-Agent": "Homer-Dashboard-Proxy/1.0",
              },
              ...(requestBody && { body: requestBody }),
            };

            // For HTTPS URLs, we need to disable certificate validation
            // This is needed for homelab services with self-signed certificates
            let response;
            if (targetUrl.startsWith("https:")) {
              // Set the global Node.js option to ignore SSL errors temporarily
              const originalRejectUnauthorized =
                process.env.NODE_TLS_REJECT_UNAUTHORIZED;
              process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

              try {
                response = await fetch(targetUrl, fetchOptions);
              } finally {
                // Restore the original setting
                if (originalRejectUnauthorized !== undefined) {
                  process.env.NODE_TLS_REJECT_UNAUTHORIZED =
                    originalRejectUnauthorized;
                } else {
                  delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
                }
              }
            } else {
              response = await fetch(targetUrl, fetchOptions);
            }

            // Capture and store session cookies from response
            const setCookieHeaders = response.headers.get("set-cookie");
            if (setCookieHeaders) {
              // Parse and store cookies for this domain
              // Handle multiple cookies properly
              const cookies = Array.isArray(setCookieHeaders)
                ? setCookieHeaders
                    .map((cookie) => cookie.split(";")[0])
                    .join("; ")
                : setCookieHeaders
                    .split(",")
                    .map((cookie) => cookie.split(";")[0])
                    .join("; ");
              sessionCookies.set(targetDomain, cookies);
            }

            // Forward response headers including session cookies and headers
            response.headers.forEach((value, key) => {
              if (
                !["content-encoding", "transfer-encoding"].includes(
                  key.toLowerCase(),
                )
              ) {
                res.setHeader(key, value);
              }
            });

            res.statusCode = response.status;
            res.statusMessage = response.statusText;

            // Use arrayBuffer to preserve exact bytes, then convert to buffer
            const responseBuffer = await response.arrayBuffer();
            const nodeBuffer = Buffer.from(responseBuffer);

            // Explicitly set content-length to ensure complete response
            res.setHeader("Content-Length", nodeBuffer.length);
            res.write(nodeBuffer);
            res.end();
          } catch (error) {
            res.statusCode = 500;
            res.end(
              JSON.stringify({
                error: "Proxy request failed",
                details: error.message,
              }),
            );
          }
        });
      },
    },
    vue(),
    VitePWA({
      registerType: "autoUpdate",
      useCredentials: true,
      manifestFilename: "assets/manifest.json",
      manifest: {
        name: "Homer dashboard",
        short_name: "Homer",
        description: "Home Server Dashboard",
        theme_color: "#3367D6",
        start_url: "../",
        scope: "../",
        icons: [
          {
            src: "./icons/pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "./icons/pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
        ],
      },
      workbox: {
        navigateFallback: null,
      },
    }),
  ],
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./node_modules", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        api: "modern-compiler",
      },
    },
  },
});

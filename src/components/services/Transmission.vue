<template>
  <Generic :item="item">
    <template #indicator>
      <div class="notifs">
        <strong v-if="count > 0" class="notif activity" title="Active Torrents">
          {{ count }}
        </strong>
        <strong
          v-if="error"
          class="notif errors"
          title="Connection error to Transmission API, check url in config.yml"
        >
          ?
        </strong>
      </div>
    </template>
  </Generic>
</template>

<script>
import service from "@/mixins/service.js";

export default {
  name: "Transmission",
  mixins: [service],
  props: { item: Object },
  data: () => ({
    count: null,
    error: null,
    sessionId: null,
  }),
  created() {
    // Validate that endpoint is configured
    if (!this.endpoint) {
      this.error = true;
      console.error("Transmission service: No endpoint configured");
      return;
    }

    const torrentInterval = parseInt(this.item.torrentInterval, 10) || 30000;

    // Set up intervals if configured (rate and torrent intervals can be different)
    if (torrentInterval > 0) {
      setInterval(() => this.getStats(), torrentInterval);
    }

    // Initial fetch
    this.getStats();
  },
  methods: {
    async transmissionRequest(method, requestArgs = {}) {
      const requestData = {
        method: method,
        arguments: requestArgs,
      };

      const options = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestData),
      };

      // Add session ID header if we have one
      if (this.sessionId) {
        options.headers["X-Transmission-Session-Id"] = this.sessionId;
      }

      try {
        const response = await this.fetch("/transmission/rpc", options);
        return response;
      } catch (error) {
        // Handle session ID requirement
        if (error.status === 409) {
          // Extract session ID from X-Transmission-Session-Id header or response text
          let sessionId = error.headers?.["x-transmission-session-id"];

          if (!sessionId && error.responseText) {
            // Extract session ID from the HTML error response
            const sessionIdMatch = error.responseText.match(
              /X-Transmission-Session-Id: ([a-zA-Z0-9]+)/,
            );
            if (sessionIdMatch) {
              sessionId = sessionIdMatch[1];
            }
          }

          if (sessionId) {
            this.sessionId = sessionId;

            // Retry with session ID
            options.headers["X-Transmission-Session-Id"] = this.sessionId;
            const retryResponse = await this.fetch(
              "/transmission/rpc",
              options,
            );
            return retryResponse;
          }
        }
        throw error;
      }
    },

    async getStats() {
      try {
        const statsResponse = await this.transmissionRequest("session-stats");

        if (statsResponse && statsResponse.result === "success") {
          const stats = statsResponse.arguments;
          this.count = stats.activeTorrentCount ?? 0;
          this.error = false;
        } else {
          throw new Error(
            `Transmission RPC failed: ${statsResponse?.result || "Unknown error"}`,
          );
        }
      } catch (e) {
        this.error = true;
        console.error("Transmission service error:", e);
      }
    },
  },
};
</script>

<style scoped lang="scss">
.notifs {
  position: absolute;
  color: white;
  font-family: sans-serif;
  top: 0.3em;
  right: 0.5em;

  .notif {
    display: inline-block;
    padding: 0.2em 0.35em;
    border-radius: 0.25em;
    position: relative;
    margin-left: 0.3em;
    font-size: 0.8em;

    &.activity {
      background-color: #4fb5d6;
    }

    &.errors {
      background-color: #e51111;
    }
  }
}
</style>

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
    /**
     * Makes a request to Transmission RPC API with proper session handling
     * @param {string} method - The RPC method to call
     * @param {Object} requestArgs - Arguments for the RPC method
     * @returns {Promise<Object>} RPC response
     */
    transmissionRequest: async function (method, requestArgs = {}) {
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

      // Add HTTP Basic Auth if credentials are provided
      if (this.item.username && this.item.password) {
        const credentials = btoa(`${this.item.username}:${this.item.password}`);
        options.headers["Authorization"] = `Basic ${credentials}`;
      }

      // Add session ID header if we have one
      if (this.sessionId) {
        options.headers["X-Transmission-Session-Id"] = this.sessionId;
      }

      try {
        const response = await fetch(
          this.endpoint + "/transmission/rpc",
          options,
        );

        // Handle session ID requirement
        if (response.status === 409) {
          this.sessionId = response.headers.get("X-Transmission-Session-Id");
          if (this.sessionId) {
            options.headers["X-Transmission-Session-Id"] = this.sessionId;
            const retryResponse = await fetch(
              this.endpoint + "/transmission/rpc",
              options,
            );
            return await retryResponse.json();
          }
        }

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
      } catch (error) {
        console.error("Transmission RPC error:", error);
        throw error;
      }
    },
    getStats: async function () {
      try {
        // Get session stats for transfer rates and torrent count
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

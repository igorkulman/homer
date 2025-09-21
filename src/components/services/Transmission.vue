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
    const interval = parseInt(this.item.interval, 10) || 30000;

    // Set up interval if configured
    if (interval > 0) {
      setInterval(() => this.getStats(), interval);
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

      // Add HTTP Basic Auth if credentials are provided
      if (this.item.auth) {
        const credentials = btoa(this.item.auth);
        options.headers["Authorization"] = `Basic ${credentials}`;
      }

      // Add session ID header if we have one
      if (this.sessionId) {
        options.headers["X-Transmission-Session-Id"] = this.sessionId;
      }

      try {
        return await this.fetch("transmission/rpc", options);
      } catch (error) {
        // Handle Transmission's 409 session requirement
        if (error.message.includes("409")) {
          // Make a direct request to get session ID
          let url = this.endpoint;
          if (url && !url.endsWith("/")) {
            url += "/";
          }
          url += "transmission/rpc";

          const sessionResponse = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ method: "session-get" }),
          });

          if (sessionResponse.status === 409) {
            this.sessionId = sessionResponse.headers.get("X-Transmission-Session-Id");
            if (this.sessionId) {
              options.headers["X-Transmission-Session-Id"] = this.sessionId;
              return await this.fetch("transmission/rpc", options);
            }
          }
        }
        console.error("Transmission RPC error:", error);
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

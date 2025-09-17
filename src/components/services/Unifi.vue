<template>
  <Generic :item="item">
    <template #content>
      <p class="title is-4">{{ item.name }}</p>
      <p class="subtitle is-6">
        <template v-if="item.subtitle">
          {{ item.subtitle }}
        </template>
        <template v-else-if="!serverError">
          <span class="sensors">
            <span
              v-if="clients !== null"
              class="sensor"
              title="Connected Clients"
            >
              <i class="fas fa-users"></i>
              <span class="sensor-value">{{ clients }}</span>
            </span>
            <span
              v-if="accessPoints !== null"
              class="sensor"
              title="Access Points"
            >
              <i class="fas fa-wifi"></i>
              <span class="sensor-value">{{ accessPoints }}</span>
            </span>
            <span
              v-if="devices !== null"
              class="sensor"
              title="Other Network Devices"
            >
              <i class="fas fa-network-wired"></i>
              <span class="sensor-value">{{ devices }}</span>
            </span>
          </span>
        </template>
        <template v-else> Connection Error </template>
      </p>
    </template>
    <template #indicator>
      <div v-if="serverError" class="status error">
        <i class="fas fa-exclamation-triangle"></i>
      </div>
    </template>
  </Generic>
</template>

<script>
import service from "@/mixins/service.js";

export default {
  name: "Unifi",
  mixins: [service],
  props: {
    item: Object,
  },
  data: () => {
    return {
      clients: null,
      devices: null,
      accessPoints: null,
      serverError: false,
      sessionCookie: null,
    };
  },
  computed: {
    site() {
      return this.item.site || "default";
    },
    prefix() {
      // Check if URL indicates we need a prefix
      if (this.item.apiUrl && this.item.apiUrl.includes("/manage")) {
        return "/manage";
      }
      if (this.item.url && this.item.url.includes("/manage")) {
        return "/manage";
      }
      return this.item.udm ? "/proxy/network" : "";
    },
    loginEndpoint() {
      // Most self-hosted controllers use /api/login (legacy endpoint)
      // Only explicitly modern controllers use /api/auth/login
      return this.item.legacy === false ? "/api/auth/login" : "/api/login";
    },
  },
  created() {
    const updateInterval = parseInt(this.item.updateInterval, 10) || 0;
    if (updateInterval > 0) {
      setInterval(() => this.fetchData(), updateInterval);
    }
    this.fetchData();
  },
  methods: {
    // Override fetch to prevent Basic Auth headers for Unifi
    fetch: function (path, init, json = true) {
      let options = {};

      if (this.proxy?.useCredentials) {
        options.credentials = "include";
      }

      if (this.proxy?.headers && !!this.proxy.headers) {
        options.headers = this.proxy.headers;
      }

      // Each item can override the credential settings
      if (this.item.useCredentials !== undefined) {
        options.credentials =
          this.item.useCredentials === true ? "include" : "omit";
      }

      // Each item can have their own headers
      if (this.item.headers !== undefined && !!this.item.headers) {
        options.headers = { ...options.headers, ...this.item.headers };
      }

      // DO NOT add Basic Auth for Unifi - it uses session cookies

      options = Object.assign(options, init);

      if (path.startsWith("/")) {
        path = path.slice(1);
      }

      let url = this.endpoint;

      if (path) {
        url = `${this.endpoint}/${path}`;
      }

      // Use proxy if enabled to avoid CORS issues
      if (this.item.useProxy || this.proxy?.enabled) {
        url = `/api/proxy/${url}`;

        // When using proxy, credentials should be handled via headers
        if (options.credentials) {
          delete options.credentials;
        }
      }

      return fetch(url, options).then(async (response) => {
        let success = response.ok;
        if (Array.isArray(this.item.successCodes)) {
          success = this.item.successCodes.includes(response.status);
        }

        if (!success) {
          // For 409 errors or other failures, preserve response data for session management
          const responseText = await response.text();
          const error = new Error(
            `Ping: target not available (${response.status} error)`,
          );
          error.response = response;
          error.responseText = responseText;
          error.status = response.status;
          error.headers = Object.fromEntries(response.headers.entries());
          throw error;
        }

        return json ? response.json() : response.text();
      });
    },
    async authenticateUnifi() {
      try {
        const loginEndpoint =
          this.item.legacy === false ? "/api/auth/login" : "/api/login";
        const credentials = {
          username: this.item.username,
          password: this.item.password,
        };

        const response = await this.fetch(loginEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(credentials),
        });

        this.sessionCookie = true;
        return true;
      } catch (error) {
        console.error("Unifi authentication failed:", error);
        this.sessionCookie = null;
        throw error;
      }
    },

    async fetchData() {
      try {
        // First authenticate if we don't have a session
        if (!this.sessionCookie) {
          await this.authenticateUnifi();
        }

        // Fetch clients and devices data
        const [clientsData, devicesData] = await Promise.all([
          this.fetch(`${this.prefix}/api/s/${this.site}/stat/sta`),
          this.fetch(`${this.prefix}/api/s/${this.site}/stat/device`),
        ]);

        this.clients = clientsData.data?.length || 0;

        // Count access points (devices with type 'uap')
        this.accessPoints =
          devicesData.data?.filter((device) => device.type === "uap")?.length ||
          0;

        // Count other devices (exclude access points to avoid double counting)
        this.devices = (devicesData.data?.length || 0) - this.accessPoints;
        this.serverError = false;
      } catch (e) {
        console.error("UniFi service error:", e);
        this.serverError = true;
        this.sessionCookie = null; // Reset session on error
      }
    },
  },
};
</script>

<style scoped lang="scss">
.sensors {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.sensor {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.status {
  font-size: 0.8rem;
  color: var(--text-title);

  &.error:before {
    background-color: #c9404d;
    border-color: #c42c3b;
    box-shadow: 0 0 5px 1px #c9404d;
  }

  &:before {
    content: " ";
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 10px;
    border: 1px solid #000;
    border-radius: 7px;
  }
}
</style>

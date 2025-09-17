export default {
  props: {
    proxy: Object,
  },
  created: function () {
    // custom service often consume info from an API using the item link (url) as a base url,
    // but sometimes the base url is different. An optional alternative URL can be provided with the "endpoint" or "apiUrl" key.
    // This is useful when running in containers where DNS resolution differs from the display URL.
    this.endpoint = this.item.apiUrl || this.item.endpoint || this.item.url;

    if (this.endpoint && this.endpoint.endsWith("/")) {
      this.endpoint = this.endpoint.slice(0, -1);
    }
  },
  methods: {
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

      // Handle HTTP Basic Auth if credentials are provided
      // Services can opt out by setting skipBasicAuth: true
      if (
        this.item.username &&
        this.item.password &&
        !this.item.skipBasicAuth
      ) {
        const credentials = btoa(`${this.item.username}:${this.item.password}`);
        options.headers = {
          ...options.headers,
          Authorization: `Basic ${credentials}`,
        };
      }

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

        // Services can handle their own retry logic in their components

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
  },
};

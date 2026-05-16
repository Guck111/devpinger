import { defineConfig } from 'astro/config';

import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  site: 'https://devpinger.com',

  server: {
    port: 4321,
  },

  adapter: cloudflare()
});
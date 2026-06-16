import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  adapter: cloudflare(),
  integrations: [tailwind(), sitemap()],
  output: 'server',
  site: 'https://sge.pages.dev',
  vite: {
    ssr: {
      external: ['@astrojs/cloudflare']
    }
  }
});
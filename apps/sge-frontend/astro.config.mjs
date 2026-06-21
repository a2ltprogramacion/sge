import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  adapter: cloudflare(),
  integrations: [sitemap()],
  output: 'server',
  site: 'https://sge.pages.dev',
  vite: {
    plugins: [tailwindcss()],
    ssr: {
      external: ['@astrojs/cloudflare']
    }
  }
});
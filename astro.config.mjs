// @ts-check
import { defineConfig, fontProviders } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  adapter: cloudflare(),
  vite: {
    plugins: [tailwindcss()],
  },
  fonts: [{
    provider: fontProviders.local(),
    name: "Departure Mono",
    cssVariable: "--font-departure-mono",
    options: {
      variants: [{
        src: ['./src/assets/fonts/DepartureMono-Regular.woff2'],
        weight: 'normal',
        style: 'normal',
      }],
    },
  }],
});

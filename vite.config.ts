import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      // Injects a responsive <link rel="preload" as="image"> for the primary LCP hero WebP
      // directly into index.html using Vite's exact hashed output URLs.
      {
        name: 'lcp-hero-preload',
        apply: 'build',
        transformIndexHtml: {
          order: 'post',
          handler(_html, ctx) {
            if (!ctx.bundle) return [];
            let mobileAsset: string | null = null;
            let desktopAsset: string | null = null;
            for (const fileName of Object.keys(ctx.bundle)) {
              if (fileName.includes('hero_sgk_library_1795494418542_mobile') && fileName.endsWith('.webp')) {
                mobileAsset = `./${fileName}`;
              } else if (fileName.includes('hero_sgk_library_1795494418542_desktop') && fileName.endsWith('.webp')) {
                desktopAsset = `./${fileName}`;
              }
            }
            if (!mobileAsset && !desktopAsset) return [];
            const srcSetParts: string[] = [];
            if (mobileAsset) srcSetParts.push(`${mobileAsset} 720w`);
            if (desktopAsset) srcSetParts.push(`${desktopAsset} 1280w`);
            return [
              {
                tag: 'link',
                attrs: {
                  rel: 'preload',
                  as: 'image',
                  type: 'image/webp',
                  href: mobileAsset || desktopAsset || undefined,
                  imagesrcset: srcSetParts.join(', '),
                  imagesizes: '100vw',
                  fetchpriority: 'high',
                },
                injectTo: 'head',
              },
            ];
          },
        },
      },
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(import.meta.dirname, 'dist');
          const srcAssets = path.resolve(import.meta.dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    build: {
      sourcemap: true,
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    server: {
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});

import { build } from 'vite';
import path from 'node:path';
import fs from 'node:fs';

async function buildExtension() {
  console.log('🚀 Starting Blackboarder build...');

  const distDir = path.resolve('dist');

  // 1. Build Popup HTML
  console.log('📦 Building Popup UI...');
  await build({
    root: path.resolve('.'),
    base: '',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        input: {
          popup: path.resolve('src/popup/index.html')
        }
      }
    }
  });

  // 2. Build Content Script (IIFE for isolated content world)
  console.log('📦 Building Content Script (content.js)...');
  await build({
    root: path.resolve('.'),
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: path.resolve('src/content/scraper.ts'),
        name: 'BlackboardSidekickContent',
        formats: ['iife'],
        fileName: () => 'content.js'
      }
    },
    define: {
      'process.env.NODE_ENV': '"production"'
    }
  });

  // 3. Build Background Service Worker (ES module)
  console.log('📦 Building Background Worker (background.js)...');
  await build({
    root: path.resolve('.'),
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: path.resolve('src/background/serviceWorker.ts'),
        formats: ['es'],
        fileName: () => 'background.js'
      }
    },
    define: {
      'process.env.NODE_ENV': '"production"'
    }
  });

  // 4. Copy content.css
  console.log('🎨 Copying content.css...');
  fs.copyFileSync(
    path.resolve('src/content/content.css'),
    path.resolve('dist/content.css')
  );

  // 5. Ensure manifest.json and icons exist in dist
  console.log('📋 Ensuring manifest.json and icons in dist...');
  if (fs.existsSync(path.resolve('public/manifest.json'))) {
    fs.copyFileSync(
      path.resolve('public/manifest.json'),
      path.resolve('dist/manifest.json')
    );
  }

  const iconsSrcDir = path.resolve('public/icons');
  const iconsDistDir = path.resolve('dist/icons');
  if (fs.existsSync(iconsSrcDir)) {
    fs.mkdirSync(iconsDistDir, { recursive: true });
    const icons = fs.readdirSync(iconsSrcDir);
    for (const icon of icons) {
      fs.copyFileSync(path.join(iconsSrcDir, icon), path.join(iconsDistDir, icon));
    }
  }

  console.log('✅ Extension successfully built in ./dist directory!');
}

buildExtension().catch(err => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});

// Generates PWA + Tauri icons from public/icons/source.png
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
const src = 'public/icons/source.png';
mkdirSync('src-tauri/icons', { recursive: true });
const out = [
  ['public/icons/icon-192.png', 192], ['public/icons/icon-512.png', 512], ['public/icons/apple-touch-icon.png', 180],
  ['src/assets/icon-64.png', 64], ['src-tauri/icons/32x32.png', 32], ['src-tauri/icons/128x128.png', 128],
  ['src-tauri/icons/128x128@2x.png', 256], ['src-tauri/icons/icon.png', 512], ['src-tauri/icons/tray.png', 64],
];
for (const [f, s] of out) await sharp(src).resize(s, s).png().toFile(f);
// maskable: icon on a solid background with safe-zone padding; apple icon must be opaque
await sharp({ create: { width: 512, height: 512, channels: 4, background: '#16161a' } })
  .composite([{ input: await sharp(src).resize(360, 360).toBuffer(), gravity: 'center' }]).png().toFile('public/icons/icon-512-maskable.png');
await sharp({ create: { width: 180, height: 180, channels: 4, background: '#16161a' } })
  .composite([{ input: await sharp(src).resize(150, 150).toBuffer(), gravity: 'center' }]).flatten({ background: '#16161a' }).png().toFile('public/icons/apple-touch-icon.png');
console.log('icons done');

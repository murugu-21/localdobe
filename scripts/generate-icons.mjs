// One-off icon generator for the PWA manifest.
// Draws "ld" as hand-built vector paths (no font/fontconfig dependency) so
// the output is deterministic across environments, then rasterizes with sharp.
// sharp is intentionally NOT a project dependency (its platform-specific optional
// deps break cross-platform `npm ci`); install it ad hoc before running:
//   npm i -D sharp --no-save && node scripts/generate-icons.mjs
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../public/icons');
mkdirSync(outDir, { recursive: true });

const BLUE = '#2563eb';
const SIZE = 512;

/**
 * "ld" glyph built from simple vector primitives, drawn in a 512x512
 * viewBox, in white, centered. Works at any raster size since it's SVG.
 */
function markSvg({ background }) {
  // Glyph geometry (viewBox units, 0-512):
  // "l": a rounded vertical stem.
  // "d": a circular bowl + a rounded vertical stem on its right (mirrors a lowercase d).
  const stemWidth = 46;
  const capRadius = stemWidth / 2;

  // l: tall stem
  const lX = 168;
  const lTop = 120;
  const lBottom = 380;

  // d: bowl (ring) + stem
  const dBowlCx = 300;
  const dBowlCy = 300;
  const dBowlOuterR = 92;
  const dBowlInnerR = 52;
  const dStemX = 368;
  const dStemTop = 120;
  const dStemBottom = 380;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">
  ${background}
  <g fill="#ffffff">
    <rect x="${lX - capRadius}" y="${lTop}" width="${stemWidth}" height="${lBottom - lTop}" rx="${capRadius}" />
    <rect x="${dStemX - capRadius}" y="${dStemTop}" width="${stemWidth}" height="${dStemBottom - dStemTop}" rx="${capRadius}" />
    <path fill-rule="evenodd" d="
      M ${dBowlCx} ${dBowlCy - dBowlOuterR}
      a ${dBowlOuterR} ${dBowlOuterR} 0 1 0 0.1 0 Z
      M ${dBowlCx} ${dBowlCy - dBowlInnerR}
      a ${dBowlInnerR} ${dBowlInnerR} 0 1 0 0.1 0 Z
    " />
  </g>
</svg>`;
}

const roundedBg = `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="96" ry="96" fill="${BLUE}" />`;
const fullBleedBg = `<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="${BLUE}" />`;

const icon512Svg = markSvg({ background: roundedBg });
const maskableSvg = markSvg({ background: fullBleedBg });

async function main() {
  await sharp(Buffer.from(icon512Svg)).resize(512, 512).png().toFile(path.join(outDir, 'icon-512.png'));
  await sharp(Buffer.from(icon512Svg)).resize(192, 192).png().toFile(path.join(outDir, 'icon-192.png'));
  await sharp(Buffer.from(maskableSvg))
    .resize(512, 512)
    .png()
    .toFile(path.join(outDir, 'icon-maskable-512.png'));
  console.log('Icons written to', outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

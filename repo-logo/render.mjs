/**
 * Rasterize an SVG to a PNG at an exact width (height follows the SVG aspect ratio).
 *
 * Usage: node render.mjs <input.svg> <output.png> <width> [background]
 *   background defaults to transparent; pass e.g. "#ffffff" for a solid fill.
 *
 * Requires @resvg/resvg-js to be resolvable (install it in the working dir, or
 * run with NODE_PATH pointing at a node_modules that contains it).
 */
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , input, output, widthArg, background = 'rgba(0,0,0,0)'] = process.argv;

if (!input || !output || !widthArg) {
  console.error('Usage: node render.mjs <input.svg> <output.png> <width> [background]');
  process.exit(1);
}

const width = Number(widthArg);
if (!Number.isFinite(width) || width <= 0) {
  console.error(`Invalid width: ${widthArg}`);
  process.exit(1);
}

const resvg = new Resvg(readFileSync(input), {
  fitTo: { mode: 'width', value: width },
  font: { loadSystemFonts: true },
  background,
});

const rendered = resvg.render();
const png = rendered.asPng();
writeFileSync(output, png);

console.log(`${output}: ${rendered.width}x${rendered.height}, ${png.length} bytes`);

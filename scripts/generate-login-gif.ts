/**
 * Build login hero GIF from public/image.png (single frame — CSS handles zoom).
 * Usage: npm run login:gif
 */
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import sharp from "sharp";

const ROOT = process.cwd();
const INPUT = resolve(ROOT, "public/image.png");
const OUTPUT = resolve(ROOT, "public/Motrex_Login.gif");

const WIDTH = 1600;
const HEIGHT = 900;
const MAX_COLORS = 128;

async function main() {
  readFileSync(INPUT);

  const gif = await sharp(INPUT)
    .rotate()
    .resize(WIDTH, HEIGHT, { fit: "cover" })
    .gif({ colours: MAX_COLORS })
    .toBuffer();

  writeFileSync(OUTPUT, gif);
  console.log(`[login-gif] wrote ${OUTPUT} (${Math.round(gif.length / 1024)} KB, single frame)`);
}

main().catch((err) => {
  console.error("[login-gif] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});

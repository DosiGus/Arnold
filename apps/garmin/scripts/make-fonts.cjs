// Renders the numeral fonts of the watch faces (Roboto Condensed Bold, Apache 2.0) into Connect IQ bitmap fonts.
// The Forerunner 255 family has no scalable fonts and its number fonts have no comma, so the app brings its own digits.
// Usage: NODE_PATH=<repo>/node_modules node apps/garmin/scripts/make-fonts.cjs [path/to/RobotoCondensed-Bold.ttf]
// The TTF defaults to the copy the Connect IQ SDK Manager installs for the simulator.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const APP = path.resolve(__dirname, "..");
const TTF =
  process.argv[2] ||
  path.join(
    os.homedir(),
    "Library/Application Support/Garmin/ConnectIQ/Fonts/RobotoCondensed-Bold.ttf",
  );

// Sizes in the 260 px grid of the design; other round displays scale them.
const FONTS = [
  { id: "NumHero", px: 96, glyphs: "0123456789:" },
  { id: "NumBig", px: 76, glyphs: "0123456789:,.-–" },
  { id: "NumMid", px: 60, glyphs: "0123456789:,.-–" },
  { id: "NumSmall", px: 52, glyphs: "0123456789:,.-–" },
];
// '' = the default resources (260 px and, for now, every display without its own set).
const DISPLAYS = [
  { dir: "resources", width: 260 },
  { dir: "resources-round-218x218", width: 218 },
  { dir: "resources-round-240x240", width: 240 },
  { dir: "resources-round-280x280", width: 280 },
];

async function main() {
  const font = fs.readFileSync(TTF).toString("base64");
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent(
    `<style>@font-face{font-family:F;src:url(data:font/ttf;base64,${font})}</style><canvas id="c"></canvas>`,
  );
  await page.evaluate(() => document.fonts.load("40px F"));
  for (const display of DISPLAYS) {
    const dir = path.join(APP, display.dir, "fonts");
    fs.mkdirSync(dir, { recursive: true });
    let xml = "<fonts>\n";
    for (const f of FONTS) {
      const px = Math.round((f.px * display.width) / 260);
      const out = await page.evaluate(
        ({ px, glyphs }) => {
          const c = document.getElementById("c");
          const ctx = c.getContext("2d");
          ctx.font = px + "px F";
          const pad = 2;
          let asc = 0,
            desc = 0;
          const m = [...glyphs].map((ch) => {
            const t = ctx.measureText(ch);
            asc = Math.max(asc, Math.ceil(t.actualBoundingBoxAscent));
            desc = Math.max(desc, Math.ceil(t.actualBoundingBoxDescent));
            return { ch, adv: Math.round(t.width) };
          });
          const height = asc + desc + 2;
          const maxRow = 250;
          let x = 0,
            y = 0,
            width = 0;
          for (const g of m) {
            const w = g.adv + 2 * pad;
            if (x + w > maxRow && x > 0) {
              x = 0;
              y += height + 1;
            }
            g.x = x;
            g.y = y;
            g.w = w;
            x += w + 1;
            width = Math.max(width, x);
          }
          c.width = width;
          c.height = y + height;
          ctx.clearRect(0, 0, c.width, c.height);
          ctx.font = px + "px F";
          ctx.fillStyle = "#fff";
          ctx.textBaseline = "alphabetic";
          for (const g of m) ctx.fillText(g.ch, g.x + pad, g.y + asc + 1);
          return {
            png: c.toDataURL("image/png").split(",")[1],
            m,
            height,
            base: asc + 1,
            w: c.width,
            h: c.height,
            pad,
          };
        },
        { px, glyphs: f.glyphs },
      );
      const name = f.id.toLowerCase();
      fs.writeFileSync(
        path.join(dir, name + ".png"),
        Buffer.from(out.png, "base64"),
      );
      const lines = [
        `info face="RobotoCondensed-Bold" size=${px} bold=1 italic=0 charset="" unicode=1 stretchH=100 smooth=1 aa=1 padding=0,0,0,0 spacing=1,1 outline=0`,
        `common lineHeight=${out.height} base=${out.base} scaleW=${out.w} scaleH=${out.h} pages=1 packed=0 alphaChnl=0 redChnl=4 greenChnl=4 blueChnl=4`,
        `page id=0 file="${name}.png"`,
        `chars count=${out.m.length}`,
        ...out.m.map(
          (g) =>
            `char id=${g.ch.codePointAt(0)} x=${g.x} y=${g.y} width=${g.w} height=${out.height} xoffset=${-out.pad} yoffset=0 xadvance=${g.adv} page=0 chnl=15`,
        ),
      ];
      fs.writeFileSync(path.join(dir, name + ".fnt"), lines.join("\n") + "\n");
      xml += `    <font id="${f.id}" filename="${name}.fnt" antialias="true"/>\n`;
      console.log(
        `${display.dir}  ${f.id}  ${px}px  ${out.w}x${out.h}  Zeile ${out.height}`,
      );
    }
    fs.writeFileSync(path.join(dir, "fonts.xml"), xml + "</fonts>\n");
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

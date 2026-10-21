/** Reproducible, silent demo of the actual portrait controllers. No provider requests. */
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { launchAuthoringBrowser } from "./character/browser.mjs";
import { PORTRAIT_RUNTIME_SOURCE } from "../src/animation/player-runtime.generated";
const assets: Record<string, string> = {},
  cast = [];
await mkdir("artifacts/preview-frames", { recursive: true });
await mkdir("docs/images", { recursive: true });
for (const name of ["mira", "noah"]) {
  const dir = `public/assets/characters/${name}`,
    catalog = JSON.parse(await readFile(`${dir}/catalog.json`, "utf8"));
  cast.push(catalog.characters[0]);
  for (const f of await readdir(dir))
    if (/\.(png|json)$/.test(f))
      assets[`/assets/characters/${name}/${f}`] =
        `data:${f.endsWith(".json") ? "application/json" : "image/png"};base64,${(await readFile(`${dir}/${f}`)).toString("base64")}`;
}
const license = await readFile("LICENSE", "utf8");
const html = `<!doctype html><!-- ${license} --><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Frame · Original example cast</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f1f3ec;color:#28342c;font:16px system-ui}main{max-width:1000px;margin:auto;padding:32px 44px}header{display:flex;align-items:end;justify-content:space-between;margin-bottom:24px}h1{font-size:36px;letter-spacing:-1.5px;margin:0}header p{font-size:13px;color:#66705e;margin:0}.cast{display:grid;grid-template-columns:1fr 1fr;gap:24px}article{position:relative;height:540px;background:linear-gradient(145deg,#e6eade,#fafbf6);border:1px solid #d5ddcd;border-radius:18px;overflow:hidden}.portrait{position:absolute;width:350px;height:525px;top:15px;left:calc(50% - 175px)}.label{position:absolute;left:18px;bottom:18px;background:#fdfef9ed;border:1px solid #dbe0d2;border-radius:12px;padding:10px 14px;min-width:140px}.label strong{display:block;font-size:20px}.label span{font-size:12px;color:#64715d}footer{display:flex;justify-content:space-between;font-size:12px;color:#64715d;margin-top:18px}.controls{padding-top:22px;text-align:center}button{border:1px solid #b6c49e;background:#d9eab7;color:#28342c;border-radius:8px;padding:8px 16px;cursor:pointer}@media(max-width:700px){main{padding:24px}.cast{grid-template-columns:1fr}header{display:block}header p{margin-top:10px}}</style>
<main><header><h1>Make them part of your story.</h1><p>frame / original example cast</p></header><section class="cast">${cast.map((c, i) => `<article><div class="portrait" id="p${i}"></div><div class="label"><strong>${c.name}</strong><span>Everyday · animated portrait</span></div></article>`).join("")}</section><footer><span>Original AI-assisted artwork · MIT reuse terms apply</span><span>Live renderer · silent demonstration</span></footer><div class="controls"><button onclick="window.demo()">Play mouth shapes &amp; blinks</button></div></main>
<script>${PORTRAIT_RUNTIME_SOURCE}</script><script>
const assets=${JSON.stringify(assets)},cast=${JSON.stringify(cast)};window.controllers=cast.map((character,i)=>FrameAnimation.createPortraitController(document.getElementById('p'+i),{character,pose:character.poses[0],settings:{life:false,blink:false,breathing:false,head:false,gaze:false,secondary:false,brow:0},resolveAsset:u=>assets[u]||u}));
window.demo=async()=>{for(const c of controllers)c.update({blink:true});for(const shape of ['X','B','C','D','E','F','A','X']){controllers.forEach(c=>c.setMouthShape(shape));if(shape==='E')controllers.forEach(c=>c.triggerBlink());await new Promise(r=>setTimeout(r,250));}controllers.forEach(c=>c.update({blink:false}));};
</script>`;
await writeFile("artifacts/rig-playground.html", html);
const browser = await launchAuthoringBrowser();
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 710 },
  });
  await page.setContent(html);
  await page.evaluate(async () => {
    for (const c of (window as any).controllers) await c.ready;
  });
  await page.waitForFunction(() =>
    (window as any).controllers.every((c: any) => c.getStatus().blinkReady),
  );
  await page.screenshot({
    path: "docs/images/cast.png",
    clip: { x: 0, y: 0, width: 1000, height: 690 },
  });
  await page.clock.install({ time: new Date("2026-10-21T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-21T12:00:01Z"));
  await page.evaluate(() => {
    (window as any).controllers.forEach((c: any) => c.update({ blink: true }));
  });
  for (let i = 0; i < 36; i++) {
    const shape = ["X", "B", "C", "D", "E", "F", "A", "X", "X"][
      Math.floor(i / 4)
    ];
    await page.evaluate(
      ({ shape, i }) => {
        (window as any).controllers.forEach((c: any) => {
          c.setMouthShape(shape);
          if (i === 18) c.triggerBlink();
        });
      },
      { shape, i },
    );
    await page.clock.runFor(1000 / 12);
    await page.screenshot({
      path: `artifacts/preview-frames/${String(i).padStart(3, "0")}.png`,
      clip: { x: 0, y: 0, width: 1000, height: 690 },
    });
  }
} finally {
  await browser.close();
}
console.log(
  "Wrote artifacts/rig-playground.html, docs/images/cast.png and 36 silent demo frames.",
);

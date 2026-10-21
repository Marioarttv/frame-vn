#!/usr/bin/env node
/** Assemble registered source pixels; this tool does not generate or paint facial artwork. */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { withCanvas } from "./image.mjs";

const file = path.resolve(process.argv[2] || "");
if (!process.argv[2])
  throw new Error(
    "Usage: assemble-mouth.mjs <mouth-assembly.json> [--replace]",
  );
const spec = JSON.parse(await readFile(file, "utf8"));
const directory = path.dirname(file);
const workspace = path.dirname(directory);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const files = {};
for (const [name, entry] of Object.entries(spec.sources)) {
  const input = path.resolve(directory, entry.file);
  if (!input.startsWith(workspace + path.sep))
    throw new Error("An assembly source escapes its character workspace.");
  if (sha(await readFile(input)) !== entry.sha256)
    throw new Error(`Source hash changed: ${name}`);
  files[name] = input;
}
if (
  spec.cells.length !== 9 ||
  spec.cells.some(
    (entry) =>
      entry !== null &&
      (!Array.isArray(entry.affine) || entry.affine.length !== 6),
  )
)
  throw new Error(
    "A mouth assembly needs nine cells with explicit source-to-portrait transforms.",
  );
const result = await withCanvas(
  files,
  spec,
  `({ images, args, helpers }) => {
  const [rx, ry, rw, rh] = args.referenceRect;
  const rect = args.mouthRect;
  const original = helpers.crop(images.portrait, args.referenceRect);
  const repair = helpers.make(rw, rh), rg = helpers.ctx(repair);
  const draw = (ctx, entry) => {
    const m = entry.affine;
    ctx.setTransform(m[0],m[1],m[2],m[3],m[4]-rx,m[5]-ry);
    ctx.drawImage(images[entry.source],0,0); ctx.resetTransform();
  };
  draw(rg,args.repair);
  const clean = helpers.crop(original,[0,0,rw,rh]), cg = helpers.ctx(clean);
  const out = cg.getImageData(0,0,rw,rh), edited = rg.getImageData(0,0,rw,rh);
  const inside = (x,y,poly) => {
    let yes=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
      const a=poly[i],b=poly[j];
      if((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) yes=!yes;
    }
    return yes;
  };
  const distance = (x,y,poly) => {
    let d=Infinity;
    for(let i=0;i<poly.length;i++) {
      const a=poly[i],b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1];
      const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1)));
      d=Math.min(d,Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy));
    }
    return d;
  };
  for(let y=0;y<rh;y++)for(let x=0;x<rw;x++) {
    const px=x+rx+.5,py=y+ry+.5,k=(y*rw+x)*4;
    if(!inside(px,py,args.repairMask))continue;
    const t=Math.min(1,distance(px,py,args.repairMask)/args.featherPixels),a=t*t*(3-2*t);
    if(edited.data[k+3]<240)throw new Error('Selected repair has transparent skin at '+px+','+py);
    for(let c=0;c<3;c++)out.data[k+c]=out.data[k+c]*(1-a)+edited.data[k+c]*a;
    out.data[k+3]=255;
  }
  cg.putImageData(out,0,0);
  const atlas=helpers.make(rw*3,rh*3),ag=helpers.ctx(atlas);
  for(let i=0;i<9;i++) {
    const entry=args.cells[i],cell=helpers.make(rw,rh),g=helpers.ctx(cell);
    // A (sealed lips) and X use the approved original pixels. Repair is separate.
    g.drawImage(entry===null?original:clean,0,0);
    if(entry!==null && i!==6)draw(g,entry);
    const pixels=g.getImageData(0,0,rw,rh);
    // An opaque facial source region stays opaque after layering supplied edits. Raw sources stay untouched.
    for(let p=0;p<pixels.data.length;p+=4)if(out.data[p+3]>=250)pixels.data[p+3]=255;
    g.putImageData(pixels,0,0);ag.drawImage(cell,(i%3)*rw,Math.floor(i/3)*rh);
  }
  return {png:helpers.png(atlas),width:atlas.width,height:atlas.height};
}`,
);
const output = path.resolve(directory, spec.output);
if (path.dirname(output) !== directory)
  throw new Error("Assembly output must remain in its edit directory.");
const bytes = Buffer.from(result.png, "base64");
try {
  const existing = await readFile(output);
  if (sha(existing) === sha(bytes)) {
    console.log(`Verified unchanged ${output}`);
    process.exit(0);
  }
  if (!process.argv.includes("--replace"))
    throw new Error(
      "Derived atlas differs; inspect it and pass --replace to rebuild. Raw sources are never overwritten.",
    );
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
await writeFile(output, bytes);
console.log(
  JSON.stringify({
    output,
    width: result.width,
    height: result.height,
    sha256: sha(bytes),
  }),
);

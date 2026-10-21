import {
  FIXED_RING,
  rectObject,
  normalizePoints,
  denormalizePoints,
  triangleArea,
  assertTransitions,
  derivedMouthFrames,
  morphLandmarks,
  ringMesh,
  mouthMeshPoints,
  closedAperture,
  fitAffine,
  invertAffine,
  transformPoint,
  insidePolygon,
  polygonDistance,
} from "./geometry.mjs";

/** Deterministic technical packing only. Every new painted pixel comes from a supplied image edit. */
export async function renderPack({ recipe, assets, urlRoot, sourceExtension }) {
  const make = (w, h) => {
    const c = document.createElement("canvas");
    c.width = Math.round(w);
    c.height = Math.round(h);
    return c;
  };
  const context = (canvas) =>
    canvas.getContext("2d", { willReadFrequently: true });
  const image = async (url) => {
    const i = new Image();
    i.src = url;
    await i.decode();
    return i;
  };
  const original = await image(assets[recipe.source]);
  const width = original.naturalWidth,
    height = original.naturalHeight;
  const originalCanvas = make(width, height);
  context(originalCanvas).drawImage(original, 0, 0);
  const loaded = new Map([[recipe.source, original]]);
  const load = async (key) => {
    if (!loaded.has(key)) loaded.set(key, await image(assets[key]));
    return loaded.get(key);
  };
  const crop = (source, rect) => {
    const c = make(rect[2], rect[3]);
    context(c).drawImage(source, ...rect, 0, 0, c.width, c.height);
    return c;
  };
  const png = (canvas) => canvas.toDataURL("image/png").split(",")[1];
  const inRect = (points, rect, label) => {
    for (const [x, y] of points)
      if (
        x < rect[0] - 0.01 ||
        y < rect[1] - 0.01 ||
        x > rect[0] + rect[2] + 0.01 ||
        y > rect[1] + rect[3] + 0.01
      )
        throw new Error(
          `${label}: a landmark or support point lies outside its calibrated rectangle.`,
        );
  };
  const fullRect = [0, 0, width, height];
  for (const [name, rect] of [
    ["mouth", recipe.mouth.rect],
    ["brows", recipe.brows.rect],
    ...recipe.eyes.map((e) => [e.id + " eye", e.rect]),
  ]) {
    if (rect.some((n) => !Number.isInteger(n)))
      throw new Error(`${name}: pixel rectangles must use integers.`);
    inRect(
      [
        [rect[0], rect[1]],
        [rect[0] + rect[2], rect[1] + rect[3]],
      ],
      fullRect,
      name,
    );
  }
  const stats = {
    sourceWidth: width,
    sourceHeight: height,
    registration: [],
    isolatedPatches: 0,
    protectedPixels: 0,
    geometryTransitions: 0,
  };
  const registrationCache = new Map();

  async function editCrop(name, cell, rect) {
    const sheet = recipe.sheets[name],
      art = await load(sheet.asset),
      cw = art.naturalWidth / sheet.columns,
      ch = art.naturalHeight / sheet.rows;
    if (
      !Number.isInteger(cell) ||
      cell < 0 ||
      cell >= sheet.columns * sheet.rows
    )
      throw new Error(`${name}: cell ${cell} is outside the sheet.`);
    const key = name + ":" + cell,
      ox = (cell % sheet.columns) * cw,
      oy = Math.floor(cell / sheet.columns) * ch;
    let matrix = registrationCache.get(key);
    if (!matrix) {
      const anchors = sheet.registrations?.[String(cell)];
      if (anchors) {
        const fit = fitAffine(anchors.sourceAnchors, anchors.portraitAnchors);
        if (fit.error > (anchors.maxErrorPixels ?? 3))
          throw new Error(
            `${name} cell ${cell}: registration RMS ${fit.error.toFixed(2)}px exceeds tolerance. Recalibrate its stable anchors.`,
          );
        matrix = fit.affine;
        stats.registration.push({
          sheet: name,
          cell,
          method: anchors.method || "anchors",
          rmsPixels: fit.error,
          ...(Number.isFinite(anchors.correlation)
            ? { correlation: anchors.correlation }
            : {}),
        });
      } else {
        const [x, y, w, h] = sheet.referenceRect;
        matrix = [w / cw, 0, 0, h / ch, x - (ox * w) / cw, y - (oy * h) / ch];
        stats.registration.push({
          sheet: name,
          cell,
          method: "reference-rectangle",
          rmsPixels: null,
        });
      }
      registrationCache.set(key, matrix);
    }
    const inverse = invertAffine(matrix),
      corners = [
        [rect[0], rect[1]],
        [rect[0] + rect[2], rect[1]],
        [rect[0], rect[1] + rect[3]],
        [rect[0] + rect[2], rect[1] + rect[3]],
      ].map((p) => transformPoint(inverse, p));
    if (
      corners.some(
        ([x, y]) =>
          x < ox - 0.5 ||
          x > ox + cw + 0.5 ||
          y < oy - 0.5 ||
          y > oy + ch + 0.5,
      )
    )
      throw new Error(
        `${name} cell ${cell}: registered feature crop reaches outside its sheet cell. Adjust referenceRect or registration anchors.`,
      );
    const out = make(rect[2], rect[3]),
      ctx = context(out);
    ctx.setTransform(
      matrix[0],
      matrix[1],
      matrix[2],
      matrix[3],
      matrix[4] - rect[0],
      matrix[5] - rect[1],
    );
    ctx.drawImage(art, 0, 0);
    ctx.resetTransform();
    return out;
  }

  function masksFor(rect, polygons, feather = 1.5) {
    const w = rect[2],
      h = rect[3],
      mask = new Float32Array(w * h);
    polygons.forEach((points) => inRect(points, rect, "Mask"));
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const px = x + rect[0] + 0.5,
          py = y + rect[1] + 0.5;
        for (const polygon of polygons)
          if (insidePolygon(px, py, polygon)) {
            const t = Math.min(
              1,
              polygonDistance(px, py, polygon) / Math.max(0.1, feather),
            );
            mask[y * w + x] = Math.max(mask[y * w + x], t * t * (3 - 2 * t));
          }
      }
    return mask;
  }
  const insetPolygon = ([x, y, w, h], inset = 2) => [
    [x + inset, y + inset],
    [x + w - inset, y + inset],
    [x + w - inset, y + h - inset],
    [x + inset, y + h - inset],
  ];
  function localComposite(
    reference,
    edited,
    mask,
    { matchColor = true, label = "An edited feature", origin = [0, 0] } = {},
  ) {
    const w = reference.width,
      h = reference.height,
      ref = context(reference).getImageData(0, 0, w, h),
      art = context(edited).getImageData(0, 0, w, h),
      out = make(w, h),
      pixels = new ImageData(new Uint8ClampedArray(ref.data), w, h);
    // Eye whites, lashes, brows and hair are not skin-color reference samples.
    // Propagating their residuals makes bright/dark patches appear on a closed lid.
    const skinSample = (data, at) =>
      data[at + 3] > 250 &&
      data[at] > 120 &&
      data[at] > data[at + 1] + 8 &&
      data[at + 1] > data[at + 2] + 8;
    const stableBoundary = (at) =>
      skinSample(ref.data, at) &&
      skinSample(art.data, at) &&
      [0, 1, 2].every(
        (c) => Math.abs(ref.data[at + c] - art.data[at + c]) < 40,
      );
    const differences = [[], [], []];
    if (matchColor)
      for (let y = 1; y < h - 1; y++)
        for (let x = 1; x < w - 1; x++) {
          const k = y * w + x,
            i = k * 4;
          if (
            mask[k] === 0 &&
            [mask[k - 1], mask[k + 1], mask[k - w], mask[k + w]].some(
              (v) => v > 0,
            ) &&
            stableBoundary(i)
          )
            for (let c = 0; c < 3; c++)
              differences[c].push(ref.data[i + c] - art.data[i + c]);
        }
    const offsets = differences.map((list) => {
      list.sort((a, b) => a - b);
      return list.length
        ? Math.max(-36, Math.min(36, list[Math.floor(list.length / 2)]))
        : 0;
    });
    // Match the surrounding painted skin, including its lighting gradient. A coarse harmonic
    // field propagates only boundary residuals; original lips never enter the healed interior.
    // This is color registration of supplied pixels, not painted/invented facial artwork.
    const step = 3,
      gw = Math.ceil((w - 1) / step) + 1,
      gh = Math.ceil((h - 1) / step) + 1,
      domain = new Uint8Array(gw * gh);
    let field = new Float32Array(gw * gh * 3),
      next = new Float32Array(field.length);
    if (matchColor) {
      for (let gy = 0; gy < gh; gy++)
        for (let gx = 0; gx < gw; gx++) {
          const x = Math.min(w - 1, gx * step),
            y = Math.min(h - 1, gy * step),
            at = (y * w + x) * 4,
            k = gy * gw + gx;
          domain[k] =
            mask[y * w + x] > 0 &&
            gx > 0 &&
            gy > 0 &&
            gx < gw - 1 &&
            gy < gh - 1
              ? 1
              : 0;
          for (let c = 0; c < 3; c++)
            field[k * 3 + c] =
              domain[k] || !stableBoundary(at)
                ? offsets[c]
                : Math.max(
                    -64,
                    Math.min(64, ref.data[at + c] - art.data[at + c]),
                  );
        }
      next.set(field);
      for (let iteration = 0; iteration < 260; iteration++) {
        for (let gy = 1; gy < gh - 1; gy++)
          for (let gx = 1; gx < gw - 1; gx++) {
            const k = gy * gw + gx;
            if (!domain[k]) continue;
            for (let c = 0; c < 3; c++)
              next[k * 3 + c] =
                (field[(k - 1) * 3 + c] +
                  field[(k + 1) * 3 + c] +
                  field[(k - gw) * 3 + c] +
                  field[(k + gw) * 3 + c]) *
                0.25;
          }
        [field, next] = [next, field];
      }
    }
    const correction = (x, y, c) => {
      if (!matchColor) return 0;
      const gx = x / step,
        gy = y / step,
        a = Math.floor(gx),
        b = Math.floor(gy),
        fx = gx - a,
        fy = gy - b,
        at = (x, y) =>
          field[(Math.min(gh - 1, y) * gw + Math.min(gw - 1, x)) * 3 + c];
      return (
        (at(a, b) * (1 - fx) + at(a + 1, b) * fx) * (1 - fy) +
        (at(a, b + 1) * (1 - fx) + at(a + 1, b + 1) * fx) * fy
      );
    };
    for (let k = 0; k < mask.length; k++) {
      const amount = mask[k],
        i = k * 4;
      if (amount > 0.95 && art.data[i + 3] < 240)
        throw new Error(
          `${label} has transparent or missing artwork inside its support mask at portrait pixel (${origin[0] + (k % w)}, ${origin[1] + Math.floor(k / w)}). Shrink the mask or supply a complete edit there.`,
        );
      if (amount > 0)
        for (let c = 0; c < 3; c++)
          pixels.data[i + c] = Math.round(
            ref.data[i + c] * (1 - amount) +
              Math.max(
                0,
                Math.min(
                  255,
                  art.data[i + c] + correction(k % w, Math.floor(k / w), c),
                ),
              ) *
                amount,
          );
      // Source alpha stays exact. Generated background/matte pixels never enter the portrait.
      if (amount === 0) {
        stats.protectedPixels++;
        for (let c = 0; c < 4; c++)
          if (pixels.data[i + c] !== ref.data[i + c])
            throw new Error(
              "Protected source pixels changed outside a localized edit.",
            );
      }
    }
    context(out).putImageData(pixels, 0, 0);
    stats.isolatedPatches++;
    return out;
  }

  /** Coverage-safe affine triangle rasterization. Each destination pixel is written once. */
  function warp(source, from, to, triangles) {
    const w = source.width,
      h = source.height,
      src = context(source).getImageData(0, 0, w, h),
      out = make(w, h),
      dst = context(out).createImageData(w, h),
      covered = new Uint8Array(w * h);
    for (const triangle of triangles) {
      const s = triangle.map((i) => [from[i][0] * w, from[i][1] * h]),
        d = triangle.map((i) => [to[i][0] * w, to[i][1] * h]);
      const [[x0, y0], [x1, y1], [x2, y2]] = d,
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
      if (den <= 1e-7)
        throw new Error("A destination feature triangle is folded.");
      for (
        let y = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
        y <= Math.min(h - 1, Math.ceil(Math.max(y0, y1, y2)));
        y++
      )
        for (
          let x = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
          x <= Math.min(w - 1, Math.ceil(Math.max(x0, x1, x2)));
          x++
        ) {
          const k = y * w + x;
          if (covered[k]) continue;
          const u =
              ((y1 - y2) * (x + 0.5 - x2) + (x2 - x1) * (y + 0.5 - y2)) / den,
            v = ((y2 - y0) * (x + 0.5 - x2) + (x0 - x2) * (y + 0.5 - y2)) / den,
            t = 1 - u - v;
          if (u < -1e-8 || v < -1e-8 || t < -1e-8) continue;
          const sx = Math.max(
              0,
              Math.min(w - 1, u * s[0][0] + v * s[1][0] + t * s[2][0] - 0.5),
            ),
            sy = Math.max(
              0,
              Math.min(h - 1, u * s[0][1] + v * s[1][1] + t * s[2][1] - 0.5),
            );
          const x0s = Math.floor(sx),
            y0s = Math.floor(sy),
            x1s = Math.min(w - 1, x0s + 1),
            y1s = Math.min(h - 1, y0s + 1),
            fx = sx - x0s,
            fy = sy - y0s;
          for (let c = 0; c < 4; c++) {
            const at = (x, y) => src.data[(y * w + x) * 4 + c];
            dst.data[k * 4 + c] =
              (at(x0s, y0s) * (1 - fx) + at(x1s, y0s) * fx) * (1 - fy) +
              (at(x0s, y1s) * (1 - fx) + at(x1s, y1s) * fx) * fy;
          }
          covered[k] = 1;
        }
    }
    if (covered.some((value) => !value))
      throw new Error("Feature triangles left uncovered pixels in the atlas.");
    context(out).putImageData(dst, 0, 0);
    return out;
  }
  const originalUrl = urlRoot + "/portrait." + sourceExtension;
  const sprite = {
    sourceWidth: width,
    sourceHeight: height,
    baseReferenceImage: originalUrl,
    performanceRig: urlRoot + "/rig.json",
    // Landmarks for morphing between this pose and the character's other expressions.
    morph: morphLandmarks(recipe),
    originalRest: true,
    colorMatch: false,
    restShape: "X",
  };
  const images = {},
    review = [];
  const face = recipe.sheets.mouth.referenceRect;
  const preview = (label, patches = []) => {
    const full = make(width, height);
    context(full).drawImage(original, 0, 0);
    for (const [patch, rect] of patches)
      context(full).drawImage(patch, rect[0], rect[1]);
    review.push({ label, canvas: crop(full, face) });
  };
  preview("Original • unchanged");

  // Rest comes from the source portrait. All six speaking frames share one completely healed base.
  const mr = recipe.mouth.rect,
    mw = mr[2],
    mh = mr[3],
    mouthOriginal = crop(original, mr);
  const support = recipe.mouth.maskPolygon || insetPolygon(mr, 2),
    repairSupport = recipe.mouth.repairMaskPolygon || support;
  const mouthMask = masksFor(mr, [support], recipe.mouth.featherPixels ?? 1.5),
    repairMask = masksFor(
      mr,
      [repairSupport],
      recipe.mouth.featherPixels ?? 1.5,
    );
  const clean = localComposite(
    mouthOriginal,
    await editCrop("mouth", recipe.mouth.repairCell ?? 6, mr),
    repairMask,
    { label: "Mouth repair", origin: [mr[0], mr[1]] },
  );
  images.repair = png(clean);
  preview("Healed mouth base", [[clean, mr]]);
  // Untraced speech shapes follow the calibrated rest mouth, so a smirk keeps its own topology.
  const derivedFrames = recipe.mouth.rest
    ? derivedMouthFrames(recipe.mouth.rest, mr)
    : undefined;
  const mouthPoints = Object.fromEntries(
    [..."ABCDEFX"].map((shape) => [
      shape,
      mouthMeshPoints(
        mr,
        shape,
        shape === "X"
          ? recipe.mouth.rest
          : recipe.mouth.frames?.[shape]?.outer &&
              recipe.mouth.frames[shape].inner
            ? recipe.mouth.frames[shape]
            : (derivedFrames?.[shape] ?? recipe.mouth.frames?.[shape]),
      ),
    ]),
  );
  Object.values(mouthPoints).forEach((points) => {
    if (points.some((p) => p.some((v) => v < 0 || v > 1)))
      throw new Error("Mouth landmarks extend outside the mouth rectangle.");
  });
  const mouthTriangles = ringMesh(Object.values(mouthPoints), 3, true);
  assertTransitions(Object.values(mouthPoints), mouthTriangles, "Mouth", true);
  stats.geometryTransitions += 49;
  const mouthAtlas = make(mw * 7, mh),
    mouthFrames = {};
  for (const [index, shape] of [..."ABCDEFX"].entries()) {
    const patch =
      shape === "X"
        ? mouthOriginal
        : localComposite(
            clean,
            await editCrop(
              "mouth",
              recipe.mouth.frames?.[shape]?.cell ?? index,
              mr,
            ),
            mouthMask,
            { label: "Mouth " + shape, origin: [mr[0], mr[1]] },
          );
    context(mouthAtlas).drawImage(patch, index * mw, 0);
    mouthFrames[shape] = {
      ...rectObject([index * mw, 0, mw, mh]),
      colorOffset: { r: 0, g: 0, b: 0 },
      landmarks: mouthPoints[shape],
    };
    if (shape !== "X") preview("Mouth " + shape, [[patch, mr]]);
  }
  images.mouth = png(mouthAtlas);
  Object.assign(sprite, {
    image: urlRoot + "/mouth.png",
    mouth: rectObject(mr),
    frames: mouthFrames,
    meshTriangles: mouthTriangles,
    feather: 0.025,
    patchMask: "rounded-rectangle",
    baseImage: urlRoot + "/repair.png",
    baseRect: rectObject(mr),
    baseSourceRect: rectObject([0, 0, mw, mh]),
    baseMask: "rounded-rectangle",
    baseFeather: 0.025,
    baseColorOffset: { r: 0, g: 0, b: 0 },
  });

  // Each eye is registered independently; exact open pixels are read from the immutable source at runtime.
  const blinkWidth = Math.max(...recipe.eyes.map((e) => e.rect[2])) * 4,
    blinkHeight = recipe.eyes.reduce((sum, e) => sum + e.rect[3], 0),
    blinkAtlas = make(blinkWidth, blinkHeight),
    eyes = [];
  const blinkPreviews = [[], [], [], []];
  let row = 0;
  for (const eye of recipe.eyes) {
    const rect = eye.rect,
      maskPolygon = eye.maskPolygon || insetPolygon(rect, 1.5);
    inRect(eye.aperture, rect, eye.id + " open aperture");
    if (eye.supportRing)
      inRect(eye.supportRing, rect, eye.id + " fixed support ring");
    const fixed = eye.supportRing
      ? [...FIXED_RING, ...normalizePoints(eye.supportRing, rect)]
      : FIXED_RING;
    const rings = eye.supportRing ? 3 : 2;
    const frames =
      eye.frames ||
      [0.25, 0.5, 0.75, 1].map((closure, cell) => ({ closure, cell }));
    for (const frame of frames)
      if (frame.targetAperture)
        inRect(frame.targetAperture, rect, eye.id + " target aperture");
    const points = [{ closure: 0 }, ...frames].map((frame) => [
      ...fixed,
      ...normalizePoints(
        frame.targetAperture || closedAperture(eye.aperture, frame.closure),
        rect,
      ),
    ]);
    const sources = frames.map((frame, index) => [
      ...fixed,
      ...normalizePoints(
        frame.aperture || closedAperture(eye.aperture, frame.closure),
        rect,
      ),
    ]);
    const triangles = ringMesh([...points, ...sources], rings);
    assertTransitions(points, triangles, eye.id + " eyelid");
    assertTransitions(sources, triangles, eye.id + " edited eyelid");
    stats.geometryTransitions += 8;
    const mask = masksFor(rect, [maskPolygon], 1.5),
      reference = crop(original, rect),
      packed = [{ closure: 0, landmarks: points[0] }];
    for (const polygon of eye.protectedPolygons || []) {
      inRect(polygon, rect, eye.id + " protected foreground");
      for (let y = 0; y < rect[3]; y++)
        for (let x = 0; x < rect[2]; x++)
          if (insidePolygon(x + rect[0] + 0.5, y + rect[1] + 0.5, polygon))
            mask[y * rect[2] + x] = 0;
    }
    for (const [index, frame] of frames.entries()) {
      const raw = await editCrop("blink", frame.cell, rect),
        registered = warp(raw, sources[index], points[index + 1], triangles),
        patch = localComposite(reference, registered, mask, {
          matchColor: eye.matchColor !== false,
          label: eye.id + " eye blink " + (index + 1),
          origin: [rect[0], rect[1]],
        });
      context(blinkAtlas).drawImage(patch, index * rect[2], row);
      packed.push({
        closure: frame.closure,
        sourceRect: rectObject([index * rect[2], row, rect[2], rect[3]]),
        landmarks: points[index + 1],
      });
      blinkPreviews[index].push([patch, rect]);
    }
    eyes.push({
      id: eye.id,
      rect: rectObject(rect),
      feather: 0.08,
      maskPolygon: normalizePoints(maskPolygon, rect),
      ...(eye.protectedPolygons
        ? {
            protectedPolygons: eye.protectedPolygons.map((polygon) =>
              normalizePoints(polygon, rect),
            ),
          }
        : {}),
      maskFeatherPixels: 1.5,
      triangles,
      apertureIndices: Array.from({ length: 8 }, (_, i) => (rings - 1) * 8 + i),
      apertureInset: 0.5,
      ...(eye.browInfluence !== undefined
        ? { browInfluence: eye.browInfluence }
        : {}),
      frames: packed,
    });
    row += rect[3];
  }
  blinkPreviews.forEach((patches, i) =>
    preview("Blink " + (i + 1) * 25 + "%", patches),
  );
  images.blink = png(blinkAtlas);
  sprite.blink = {
    image: urlRoot + "/blink.png",
    referenceImage: originalUrl,
    eyes,
  };

  // Brows use a fixed support mask; the edited eyes, hair, and mouth never enter this layer.
  const br = recipe.brows.rect,
    bw = br[2],
    bh = br[3],
    browMask = masksFor(
      br,
      recipe.brows.maskPolygons,
      recipe.brows.featherPixels ?? 1.5,
    );
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++)
      if (
        browMask[y * bw + x] > 0 &&
        recipe.eyes.some((eye) =>
          insidePolygon(x + br[0] + 0.5, y + br[1] + 0.5, eye.aperture),
        )
      )
        throw new Error(
          "Brow support overlaps an eye aperture. Protect the eyes in the brow mask.",
        );
  const grid = [],
    columns = 12,
    rows = 7,
    triangles = [];
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < columns; x++)
      grid.push([x / (columns - 1), y / (rows - 1)]);
  for (let y = 0; y < rows - 1; y++)
    for (let x = 0; x < columns - 1; x++) {
      const a = y * columns + x,
        b = a + 1,
        c = a + columns,
        d = c + 1;
      triangles.push([a, b, d], [a, d, c]);
    }
  const browFrames = [{ value: 0, landmarks: grid }],
    browAtlas = make(bw * 3, bh),
    browOriginal = crop(original, br);
  const authoredBrows = recipe.brows.frames || [
    { cell: 0, value: -1 },
    { cell: 1, value: 1 },
  ];
  for (const [index, frame] of authoredBrows.entries()) {
    const moved = grid.map(([x, y]) => {
      if (x === 0 || x === 1 || y === 0 || y === 1) return [x, y];
      const px = br[0] + x * bw,
        py = br[1] + y * bh;
      let dx = 0,
        dy = 0,
        total = 0;
      for (const control of frame.controls || []) {
        const radius = control.radius || bw * 0.18,
          weight = Math.exp(
            (-((px - control.from[0]) ** 2 + (py - control.from[1]) ** 2) /
              (radius * radius)) *
              2,
          );
        dx += (control.to[0] - control.from[0]) * weight;
        dy += (control.to[1] - control.from[1]) * weight;
        total += weight;
      }
      const edge = Math.min(1, x * 6, (1 - x) * 6, y * 6, (1 - y) * 6);
      return [
        x + (dx / Math.max(1, total) / bw) * edge,
        y + (dy / Math.max(1, total) / bh) * edge,
      ];
    });
    const patch = localComposite(
      browOriginal,
      recipe.brows.sourcePixels
        ? warp(browOriginal, grid, moved, triangles)
        : await editCrop("brows", frame.cell, br),
      browMask,
      {
        matchColor: recipe.brows.matchColor !== false,
        label: "Brows cell " + frame.cell,
        origin: [br[0], br[1]],
      },
    );
    context(browAtlas).drawImage(patch, index * bw, 0);
    browFrames.push({
      value: frame.value,
      sourceRect: rectObject([index * bw, 0, bw, bh]),
      landmarks: moved,
    });
    preview(frame.value < 0 ? "Brows • furrow" : "Brows • raise", [
      [patch, br],
    ]);
  }
  browFrames.sort((a, b) => a.value - b.value);
  assertTransitions(
    browFrames.map((f) => f.landmarks),
    triangles,
    "Brows",
    true,
  );
  stats.geometryTransitions += 3;
  const maskPixels = context(browAtlas).createImageData(bw, bh);
  for (let i = 0; i < browMask.length; i++) {
    maskPixels.data[i * 4] =
      maskPixels.data[i * 4 + 1] =
      maskPixels.data[i * 4 + 2] =
        255;
    maskPixels.data[i * 4 + 3] = Math.round(browMask[i] * 255);
  }
  context(browAtlas).putImageData(maskPixels, bw * 2, 0);
  images.brows = png(browAtlas);
  const brows = {
    schemaVersion: 1,
    pose: recipe.pose.id,
    sourceWidth: width,
    sourceHeight: height,
    image: urlRoot + "/brows.png",
    rect: rectObject(br),
    maskRect: rectObject([bw * 2, 0, bw, bh]),
    triangles,
    frames: browFrames,
  };

  // Gaze only replaces the old iris's footprint with edited sclera. The moving iris is the original artwork.
  const gazeAtlas = make(
      Math.max(...recipe.eyes.map((e) => e.rect[2])),
      blinkHeight,
    ),
    gazeEyes = [],
    gazePreviews = [];
  row = 0;
  for (const eye of recipe.eyes) {
    const r = eye.rect,
      [cx, cy] = eye.iris.center,
      [rx, ry] = eye.iris.radius;
    inRect(
      [
        [cx - rx, cy - ry],
        [cx + rx, cy + ry],
      ],
      r,
      eye.id + " iris",
    );
    const support = new Float32Array(r[2] * r[3]);
    for (let y = 0; y < r[3]; y++)
      for (let x = 0; x < r[2]; x++) {
        const px = r[0] + x + 0.5,
          py = r[1] + y + 0.5,
          d = Math.hypot((px - cx) / (rx * 1.2), (py - cy) / (ry * 1.2));
        if (insidePolygon(px, py, eye.aperture)) {
          const t = Math.max(
            0,
            Math.min(1, ((1 - d) * Math.min(rx, ry)) / 1.3),
          );
          support[y * r[2] + x] = t * t * (3 - 2 * t);
        }
      }
    const patch = localComposite(
      crop(original, r),
      await editCrop("gaze", 0, r),
      support,
      { label: eye.id + " eye sclera", origin: [r[0], r[1]] },
    );
    context(gazeAtlas).drawImage(patch, 0, row);
    gazePreviews.push([patch, r]);
    gazeEyes.push({
      rect: rectObject(r),
      sourceRect: rectObject([0, row, r[2], r[3]]),
      iris: {
        x: cx,
        y: cy,
        radiusX: rx,
        radiusY: ry,
        feather: eye.iris.feather ?? 0.75,
      },
      maxShiftX: Math.min(5, eye.iris.maxShift?.[0] ?? Math.max(1, rx * 0.25)),
      maxShiftY: Math.min(
        2,
        eye.iris.maxShift?.[1] ?? Math.max(0.5, ry * 0.12),
      ),
      originalAperture: eye.aperture,
    });
    row += r[3];
  }
  preview("Gaze • clean sclera", gazePreviews);
  images.gaze = png(gazeAtlas);
  const gaze = {
    sourceWidth: width,
    sourceHeight: height,
    image: urlRoot + "/gaze.png",
    eyes: gazeEyes,
  };

  // Head, jaw, cheeks, hair and clothing all warp the same facial composite in normalized 1024 units.
  const sx = 1024 / width,
    sy = 1024 / height,
    body = recipe.body,
    rest = mouthPoints.X;
  const center = [
      (mr[0] + rest[24][0] * mw) * sx,
      (mr[1] + rest[24][1] * mh) * sy,
    ],
    lipBottom = (mr[1] + rest[14][1] * mh) * sy,
    chin = body.chin * sy,
    neck = body.neck * sy;
  if (!(lipBottom < chin && chin < neck && neck <= 1024))
    throw new Error(
      "Jaw calibration must place the chin below the lower lip and the neck below the chin, within the portrait.",
    );
  const halfWidth = ((rest[12][0] - rest[8][0]) * mw * sx) / 2,
    reach = chin - lipBottom;
  const rig = {
    sourceWidth: width,
    sourceHeight: height,
    referenceImage: originalUrl,
    gaze: urlRoot + "/gaze.json",
    lines: urlRoot + "/performance.json",
    breathing: {
      fixedTop: (body.breathing?.fixedTop ?? body.head.rigidUntil) * sy,
      vertical: (body.breathing?.vertical ?? height * 0.004) * sy,
      horizontal: (body.breathing?.horizontal ?? width * 0.0015) * sx,
    },
    head: {
      pivot: [body.head.pivot[0] * sx, body.head.pivot[1] * sy],
      rigidUntil: body.head.rigidUntil * sy,
      anchoredFrom: body.head.anchoredFrom * sy,
    },
    hair: (body.hair || []).map((zone) => ({
      x: zone.x.map((n) => n * sx),
      y: zone.y.map((n) => n * sy),
      vector: zone.vector,
    })),
    clothing: body.clothing
      ? {
          left: body.clothing.left.map((n) => n * sx),
          right: body.clothing.right.map((n) => n * sx),
          y: body.clothing.y.map((n) => n * sy),
        }
      : {
          left: [80, 340],
          right: [680, 940],
          y: [Math.min(850, neck), Math.min(900, neck + 50), 990, 1024],
        },
    jaw: {
      center: center[0],
      top: lipBottom,
      full: lipBottom + reach * 0.55,
      chin,
      neck,
      width: [Math.min(70, halfWidth * 1.2), Math.min(400, halfWidth * 2.7)],
      drop: Math.max(0.5, Math.min(7, (neck - chin) / 1.8)),
      taper: 0.55,
    },
    cheeks: {
      center,
      radius: [
        Math.min(125, halfWidth * 1.9),
        Math.max(5, Math.min(34, mh * sy * 0.23)),
        Math.max(5, chin - center[1]),
      ],
      lips: [
        Math.min(100, halfWidth * 1.3),
        Math.max(5, Math.min(36, (lipBottom - center[1]) * 1.25)),
      ],
      stretch: 0.055,
      push: 0.045,
    },
  };

  const tw = 280,
    th = 320,
    cols = 4,
    reviewCanvas = make(tw * cols, th * Math.ceil(review.length / cols)),
    reviewContext = context(reviewCanvas);
  reviewContext.fillStyle = "#1b2028";
  reviewContext.fillRect(0, 0, reviewCanvas.width, reviewCanvas.height);
  reviewContext.font = "14px sans-serif";
  reviewContext.fillStyle = "#eee";
  review.forEach(({ label, canvas }, i) => {
    const x = (i % cols) * tw,
      y = Math.floor(i / cols) * th,
      scale = Math.min((tw - 12) / canvas.width, (th - 34) / canvas.height);
    reviewContext.drawImage(
      canvas,
      x + (tw - canvas.width * scale) / 2,
      y + 28,
      canvas.width * scale,
      canvas.height * scale,
    );
    reviewContext.fillText(label, x + 9, y + 20);
  });
  images.review = png(reviewCanvas);
  return { width, height, sprite, rig, brows, gaze, images, stats };
}

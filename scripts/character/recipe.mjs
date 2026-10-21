const slug = (value) =>
  typeof value === "string" && /^[a-z][a-z0-9_-]{1,63}$/.test(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const point = (value) =>
  Array.isArray(value) && value.length === 2 && value.every(finite);
const rectangle = (value) =>
  Array.isArray(value) &&
  value.length === 4 &&
  value.every(finite) &&
  value[0] >= 0 &&
  value[1] >= 0 &&
  value[2] > 0 &&
  value[3] > 0;
const polygon = (value, count) =>
  Array.isArray(value) &&
  (count ? value.length === count : value.length >= 3 && value.length <= 32) &&
  value.every(point);

/** Validate untrusted recipes before loading media or launching a browser. */
export function validateRecipe(recipe, dimensions) {
  const errors = [],
    warnings = [];
  const check = (valid, message) => {
    if (!valid) errors.push(message);
  };
  if (!recipe || typeof recipe !== "object")
    return { valid: false, errors: ["Recipe must be an object."], warnings };
  check(
    recipe.schemaVersion === 1,
    "Unsupported recipe schemaVersion; expected 1.",
  );
  check(
    slug(recipe.pack?.id),
    "pack.id must be a lowercase identifier, 2–64 characters.",
  );
  check(
    slug(recipe.character?.id),
    "character.id must be a lowercase identifier, 2–64 characters.",
  );
  check(
    slug(recipe.pose?.id),
    "pose.id must be a lowercase identifier, 2–64 characters.",
  );
  for (const [name, value] of [
    ["pack.name", recipe.pack?.name],
    ["character.name", recipe.character?.name],
    ["pose.name", recipe.pose?.name],
  ])
    check(
      typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= 100,
      `${name} is required (max 100 characters).`,
    );
  check(
    typeof recipe.source === "string" &&
      recipe.source.length > 0 &&
      recipe.source.length <= 128,
    "source must identify an uploaded asset.",
  );
  check(
    typeof recipe.character?.color === "string" &&
      /^#[a-fA-F0-9]{6}$/.test(recipe.character.color),
    "character.color must be a six-digit hex color.",
  );
  if (recipe.provenance)
    for (const key of ["name", "url", "creator", "license"])
      check(
        recipe.provenance[key] === undefined ||
          (typeof recipe.provenance[key] === "string" &&
            recipe.provenance[key].length <= 1000),
        `provenance.${key} must be descriptive text, max 1000 characters.`,
      );
  const rect = (value, name) => {
    check(
      rectangle(value),
      `${name} must be [x,y,width,height] with positive dimensions.`,
    );
    if (rectangle(value) && dimensions)
      check(
        value[0] + value[2] <= dimensions.width &&
          value[1] + value[3] <= dimensions.height,
        `${name} extends outside the source portrait.`,
      );
  };
  if (recipe.registrationRegion)
    rect(recipe.registrationRegion, "registrationRegion");
  if (recipe.autoRegister && !recipe.registrationRegion)
    errors.push(
      "Automatic registration requires a calibrated unchanged-detail region.",
    );
  for (const name of ["mouth", "blink", "brows", "gaze"]) {
    const sheet = recipe.sheets?.[name];
    check(
      typeof sheet?.asset === "string" &&
        sheet.asset.length > 0 &&
        sheet.asset.length <= 128,
      `${name} sheet needs an uploaded asset.`,
    );
    check(
      Number.isInteger(sheet?.columns) &&
        sheet.columns > 0 &&
        sheet.columns <= 8 &&
        Number.isInteger(sheet?.rows) &&
        sheet.rows > 0 &&
        sheet.rows <= 8,
      `${name} sheet grid must contain 1–8 columns and rows.`,
    );
    rect(sheet?.referenceRect, `${name}.referenceRect`);
    if (sheet?.registrations)
      for (const [cell, registration] of Object.entries(sheet.registrations)) {
        check(
          /^\d+$/.test(cell) && Number(cell) < sheet.columns * sheet.rows,
          `${name} registration cell ${cell} is outside its grid.`,
        );
        check(
          Array.isArray(registration?.sourceAnchors) &&
            registration.sourceAnchors.length >= 3 &&
            registration.sourceAnchors.length <= 20 &&
            registration.sourceAnchors.every(point),
          `${name} cell ${cell} needs 3–20 source registration anchors.`,
        );
        check(
          Array.isArray(registration?.portraitAnchors) &&
            registration.portraitAnchors.length ===
              registration.sourceAnchors?.length &&
            registration.portraitAnchors.every(point),
          `${name} cell ${cell} needs the matching portrait registration anchors.`,
        );
      }
  }
  rect(recipe.mouth?.rect, "mouth.rect");
  if (recipe.mouth?.rest)
    for (const key of ["outer", "inner"])
      check(
        polygon(recipe.mouth.rest[key], 8),
        `mouth.rest.${key} needs eight points.`,
      );
  if (recipe.mouth?.rest)
    check(point(recipe.mouth.rest.center), "mouth.rest.center needs [x,y].");
  if (!recipe.mouth?.rest)
    warnings.push(
      "Rest-mouth geometry is estimated; inspect and calibrate it before acceptance.",
    );
  const mouthCells = recipe.sheets?.mouth?.columns * recipe.sheets?.mouth?.rows;
  for (const [i, shape] of [..."ABCDEF"].entries()) {
    const frame = recipe.mouth?.frames?.[shape];
    const cell = frame?.cell ?? i;
    check(
      Number.isInteger(cell) && cell >= 0 && cell < mouthCells,
      `Mouth frame ${shape} cell is outside its sheet.`,
    );
    if (frame?.outer)
      check(polygon(frame.outer, 8), `${shape} outer lip needs eight points.`);
    if (frame?.inner)
      check(polygon(frame.inner, 8), `${shape} inner lip needs eight points.`);
    if (frame?.center)
      check(point(frame.center), `${shape} mouth center needs [x,y].`);
    if ((!frame?.outer || !frame?.inner) && !recipe.mouth?.rest)
      warnings.push(
        `${shape} mouth geometry is estimated from its shape class; inspect the edited artwork.`,
      );
  }
  check(
    Number.isInteger(recipe.mouth?.repairCell ?? 6) &&
      (recipe.mouth?.repairCell ?? 6) < mouthCells &&
      (recipe.mouth?.repairCell ?? 6) >= 0,
    "The mouth repair cell is outside its sheet.",
  );
  check(
    Array.isArray(recipe.eyes) && [1, 2].includes(recipe.eyes.length),
    "One or two visible calibrated eyes are required.",
  );
  if (Array.isArray(recipe.eyes))
    for (const [i, eye] of recipe.eyes.entries()) {
      check(
        recipe.eyes.length === 1
          ? ["left", "right"].includes(eye?.id)
          : eye?.id === (i === 0 ? "left" : "right"),
        "Visible eyes must have unique left/right IDs, in portrait order.",
      );
      rect(eye?.rect, `eyes[${i}].rect`);
      check(
        polygon(eye?.aperture, 8),
        `eyes[${i}].aperture needs eight clockwise points.`,
      );
      check(
        point(eye?.iris?.center) &&
          point(eye?.iris?.radius) &&
          eye.iris.radius.every((value) => value > 0),
        `eyes[${i}] requires iris center and positive radii.`,
      );
      if (eye?.maskPolygon)
        check(polygon(eye.maskPolygon), `eyes[${i}].maskPolygon is invalid.`);
      if (eye?.protectedPolygons)
        check(
          Array.isArray(eye.protectedPolygons) &&
            eye.protectedPolygons.every((value) => polygon(value)),
          `eyes[${i}].protectedPolygons is invalid.`,
        );
      if (eye?.browInfluence !== undefined)
        check(
          Number.isFinite(eye.browInfluence) &&
            eye.browInfluence >= 0 &&
            eye.browInfluence <= 1,
          `eyes[${i}].browInfluence must be between 0 and 1.`,
        );
      if (eye?.supportRing)
        check(
          polygon(eye.supportRing, 8),
          `eyes[${i}].supportRing needs eight clockwise points.`,
        );
      const frames =
        eye?.frames ||
        [0.25, 0.5, 0.75, 1].map((closure, cell) => ({ closure, cell }));
      check(
        frames.length === 4 &&
          frames.every(
            (frame, index) =>
              frame.closure === (index + 1) / 4 &&
              Number.isInteger(frame.cell) &&
              frame.cell >= 0 &&
              frame.cell <
                recipe.sheets?.blink?.columns * recipe.sheets?.blink?.rows &&
              (!frame.aperture || polygon(frame.aperture, 8)) &&
              (!frame.targetAperture || polygon(frame.targetAperture, 8)),
          ),
        `eyes[${i}] needs blink frames at .25, .5, .75 and 1, in sheet bounds.`,
      );
    }
  rect(recipe.brows?.rect, "brows.rect");
  check(
    Array.isArray(recipe.brows?.maskPolygons) &&
      recipe.brows.maskPolygons.length > 0 &&
      recipe.brows.maskPolygons.length <= 4 &&
      recipe.brows.maskPolygons.every((value) => polygon(value)),
    "brows.maskPolygons must bound the brows while protecting eyes and hair.",
  );
  if (recipe.brows?.frames) {
    check(
      recipe.brows.frames.length === 2 &&
        recipe.brows.frames.some((frame) => frame.value === -1) &&
        recipe.brows.frames.some((frame) => frame.value === 1),
      "Brow frames must contain furrow (-1) and raise (+1).",
    );
    for (const frame of recipe.brows.frames) {
      check(
        Number.isInteger(frame.cell) &&
          frame.cell >= 0 &&
          frame.cell <
            recipe.sheets?.brows?.columns * recipe.sheets?.brows?.rows,
        "A brow frame is outside its sheet.",
      );
      check(
        !frame.controls ||
          (Array.isArray(frame.controls) &&
            frame.controls.length <= 24 &&
            frame.controls.every(
              (c) =>
                point(c.from) &&
                point(c.to) &&
                (c.radius === undefined || (finite(c.radius) && c.radius > 0)),
            )),
        "Brow controls must map source points to their edited positions.",
      );
    }
  }
  check(point(recipe.body?.head?.pivot), "body.head.pivot is required.");
  check(
    finite(recipe.body?.head?.rigidUntil) &&
      finite(recipe.body?.head?.anchoredFrom) &&
      recipe.body.head.anchoredFrom > recipe.body.head.rigidUntil,
    "Body head region must end above the torso anchor.",
  );
  check(
    finite(recipe.body?.chin) &&
      finite(recipe.body?.neck) &&
      recipe.body.neck > recipe.body.chin,
    "Calibrate chin and neck below the mouth.",
  );
  if (recipe.calibrationStatus !== "reviewed")
    warnings.push(
      "This is a draft calibration. Browser playback and pixel-isolation review are still required.",
    );
  return { valid: errors.length === 0, errors, warnings };
}

/** A clearly labelled geometric starting point; these estimates do not identify facial features. */
export function createDraftRecipe({
  packId,
  characterName,
  sourceAsset,
  width,
  height,
  face,
  sheets = {},
}) {
  const box = face || [width * 0.25, height * 0.08, width * 0.5, height * 0.57];
  const [x, y, w, h] = box;
  const r = (values) => values.map(Math.round);
  const polygonFor = (rect) => {
    const [x, y, w, h] = rect;
    return [
      [x + 2, y + 2],
      [x + w - 2, y + 2],
      [x + w - 2, y + h - 2],
      [x + 2, y + h - 2],
    ];
  };
  const mouth = r([x + w * 0.29, y + h * 0.62, w * 0.42, h * 0.23]);
  const brows = r([x + w * 0.11, y + h * 0.18, w * 0.78, h * 0.18]);
  const eye = (id, left) => {
    const rect = r([x + w * left, y + h * 0.31, w * 0.29, h * 0.15]);
    const [ex, ey, ew, eh] = rect,
      cx = ex + ew / 2,
      cy = ey + eh * 0.55,
      rx = ew * 0.39,
      ry = eh * 0.23;
    const aperture = Array.from({ length: 8 }, (_, i) => [
      cx - Math.cos((i * Math.PI) / 4) * rx,
      cy - Math.sin((i * Math.PI) / 4) * ry,
    ]);
    return {
      id,
      rect,
      aperture,
      maskPolygon: polygonFor(rect),
      iris: { center: [cx, cy], radius: [ew * 0.12, eh * 0.26] },
    };
  };
  const lower = Math.min(height * 0.91, y + h * 1.08),
    neck = Math.min(height * 0.95, y + h * 1.02);
  return {
    schemaVersion: 1,
    pack: { id: packId, name: characterName + " character pack" },
    character: { id: packId, name: characterName, color: "#9ab4ac" },
    pose: { id: packId + "_default", name: "Default" },
    source: sourceAsset,
    calibrationStatus: "draft",
    autoRegister: true,
    registrationRegion: r([x + w * 0.39, y + h * 0.49, w * 0.23, h * 0.16]),
    sheets: {
      mouth: {
        asset: sheets.mouth || "",
        columns: 4,
        rows: 2,
        referenceRect: r(box),
      },
      blink: {
        asset: sheets.blink || "",
        columns: 2,
        rows: 2,
        referenceRect: r(box),
      },
      brows: {
        asset: sheets.brows || "",
        columns: 2,
        rows: 1,
        referenceRect: r(box),
      },
      gaze: {
        asset: sheets.gaze || "",
        columns: 1,
        rows: 1,
        referenceRect: r(box),
      },
    },
    mouth: { rect: mouth, repairCell: 6 },
    eyes: [eye("left", 0.12), eye("right", 0.59)],
    brows: {
      rect: brows,
      maskPolygons: [
        polygonFor(r([x + w * 0.13, y + h * 0.21, w * 0.28, h * 0.12])),
        polygonFor(r([x + w * 0.59, y + h * 0.21, w * 0.28, h * 0.12])),
      ],
    },
    body: {
      head: {
        pivot: [x + w * 0.5, neck],
        rigidUntil: Math.min(height * 0.82, y + h * 0.96),
        anchoredFrom: Math.max(lower + 1, Math.min(height * 0.99, y + h * 1.4)),
      },
      chin: Math.min(height * 0.9, y + h * 0.92),
      neck,
      breathing: {
        fixedTop: lower,
        vertical: height * 0.0045,
        horizontal: width * 0.0015,
      },
      hair: [],
      clothing: {
        left: [width * 0.1, width * 0.35],
        right: [width * 0.65, width * 0.9],
        y: [
          lower,
          Math.min(height * 0.94, lower + height * 0.05),
          height * 0.97,
          height,
        ],
      },
    },
  };
}

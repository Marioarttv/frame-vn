import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Download,
  ImagePlus,
  LoaderCircle,
  Move,
  ScanFace,
  Upload,
} from "lucide-react";
import {
  createDraftRecipe,
  validateRecipe,
} from "../../scripts/character/recipe.mjs";
import type {
  CharacterRecipe,
  MouthLandmarks,
  Point,
  Rect,
} from "../../scripts/character/schema";
import type { Character } from "../engine/types";
import { getHealth } from "./VoiceWorkbench";
import "./rig-builder.css";

interface Props {
  /** Characters a new expression can be added to. */
  characters?: Character[];
  onCharacter: (character: Character) => void;
  onNotice: (message: string) => void;
}
const BUILD_ID = /^[a-z][a-z0-9_-]{1,63}$/;
interface Asset {
  assetId: string;
  src: string;
  width: number;
  height: number;
  mime: string;
  bytes: number;
  name?: string;
}
type Sheet = "mouth" | "blink" | "brows" | "gaze";
type Target =
  "face" | "registration" | "mouth" | "left" | "right" | "brows" | "head";
interface RegistrationResult {
  sheet: string;
  cell: number;
  correlation?: number;
  method?: string;
  rmsPixels?: number;
}
type AssetMap = Partial<Record<"source" | Sheet, Asset>>;
type Landmark = { key: string; name: string; point: Point };
const draftStorageKey = "frame-character-workshop-draft-v1";
const sheetInfo: Record<
  Sheet,
  { title: string; grid: string; cells: string[]; brief: string }
> = {
  mouth: {
    title: "Speech & repair",
    grid: "4 × 2",
    cells: [
      "A · closed lips",
      "B · teeth",
      "C · open",
      "D · wide open",
      "E · rounded",
      "F · puckered",
      "Repair · no mouth",
      "Reference · original",
    ],
    brief:
      "Create eight equally sized face crops in a 4-column, 2-row sheet, in row-major order. Change only the mouth. A: closed lips (M/B/P); B: lightly parted teeth; C: open mouth; D: wide open mouth; E: rounded lips; F: puckered lips; cell 7: healed skin with the entire original mouth and its corners removed; cell 8: unchanged source reference. Preserve the same mouth corners, face, pose, lighting and crop in every cell. The rest state always uses the original portrait.",
  },
  blink: {
    title: "Eyelid progression",
    grid: "2 × 2",
    cells: ["25% closed", "50% closed", "75% closed", "100% closed"],
    brief:
      "Create four equally sized face crops in a 2-column, 2-row sheet. In row-major order close both eyelids by 25%, 50%, 75%, and 100%. Keep eye corners, lower lids, irises, brows, hair, expression, lighting, and pose fixed. Preserve each eye’s perspective. Edit only the moving eyelids; the fully open state uses the original portrait.",
  },
  brows: {
    title: "Brow expressions",
    grid: "2 × 1",
    cells: ["Furrow · −1", "Raised · +1"],
    brief:
      "Create two equally sized face crops side by side. Left: subtly furrowed brows. Right: subtly raised brows. Complete the skin revealed beneath the original brows. Keep eyes, hair, nose, mouth, face, pose and lighting unchanged. Movement must stay within the calibrated brow support polygons.",
  },
  gaze: {
    title: "Clean eye plate",
    grid: "1 × 1",
    cells: ["Sclera · irises removed"],
    brief:
      "Create one face crop matching the source reference. Remove the iris and pupil from each eye and reconstruct the whites of the eyes in their existing lighting. Preserve eye contours, eyelids, lashes, brows, hair, and every other feature. The engine moves the original irises over this clean plate.",
  },
};
const targetNames: Record<Target, string> = {
  face: "Face reference",
  registration: "Alignment patch",
  mouth: "Mouth",
  left: "Left eye",
  right: "Right eye",
  brows: "Brows",
  head: "Head & body",
};
const targetColors: Record<Target, string> = {
  face: "#8c9a84",
  registration: "#b18d59",
  mouth: "#db967c",
  left: "#86b3bb",
  right: "#a395c1",
  brows: "#b7b476",
  head: "#92b774",
};
const round = (value: number) => Math.round(value * 10) / 10;
const slug = (value: string) => {
  const id = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return /^[a-z][a-z0-9-]+$/.test(id) ? id : `character-${id || "new"}`;
};
const clone = (recipe: CharacterRecipe) => structuredClone(recipe);
const ellipse = (cx: number, cy: number, rx: number, ry: number): Point[] =>
  Array.from({ length: 8 }, (_, i) => [
    round(cx - Math.cos((i * Math.PI) / 4) * rx),
    round(cy - Math.sin((i * Math.PI) / 4) * ry),
  ]);
function restFor(rect: Rect): MouthLandmarks {
  const [x, y, w, h] = rect,
    cx = x + w / 2,
    cy = y + h * 0.48;
  return {
    center: [round(cx), round(cy)],
    outer: ellipse(cx, cy, w * 0.43, h * 0.15),
    inner: ellipse(cx, cy, w * 0.39, Math.max(0.6, h * 0.025)),
  };
}
function registrationFor([x, y, width, height]: Rect): Rect {
  return [x + width * 0.42, y + height * 0.44, width * 0.16, height * 0.15].map(
    Math.round,
  ) as Rect;
}
function preparedDraft(
  options: Parameters<typeof createDraftRecipe>[0],
): CharacterRecipe {
  const next = createDraftRecipe(options);
  next.mouth.rest = restFor(next.mouth.rect);
  next.registrationRegion = registrationFor(next.sheets.mouth.referenceRect);
  next.autoRegister = true;
  return next;
}
function getRect(recipe: CharacterRecipe, target: Target): Rect | undefined {
  if (target === "face") return recipe.sheets.mouth.referenceRect;
  if (target === "registration")
    return (
      recipe.registrationRegion ||
      registrationFor(recipe.sheets.mouth.referenceRect)
    );
  if (target === "mouth") return recipe.mouth.rect;
  if (target === "brows") return recipe.brows.rect;
  if (target === "left" || target === "right")
    return recipe.eyes.find((eye) => eye.id === target)?.rect;
}
function mapPoint(point: Point, from: Rect, to: Rect): Point {
  return [
    round(to[0] + ((point[0] - from[0]) * to[2]) / from[2]),
    round(to[1] + ((point[1] - from[1]) * to[3]) / from[3]),
  ];
}
function changeRect(
  recipe: CharacterRecipe,
  target: Target,
  rectangle: Rect,
): CharacterRecipe {
  const rect = rectangle.map(Math.round) as Rect;
  const next = clone(recipe),
    previous = getRect(recipe, target);
  if (!previous) return next;
  const map = (point: Point) => mapPoint(point, previous, rect);
  if (target === "face") {
    for (const sheet of Object.values(next.sheets))
      sheet.referenceRect = [...rect];
  }
  if (target === "registration") {
    next.registrationRegion = rect;
    for (const sheet of Object.values(next.sheets))
      for (const [cell, registration] of Object.entries(
        sheet.registrations || {},
      )) {
        if (
          (registration as typeof registration & { method?: string }).method ===
          "stable-template-ncc"
        )
          delete sheet.registrations![cell];
      }
  }
  if (target === "mouth") {
    next.mouth.rect = rect;
    if (next.mouth.rest)
      next.mouth.rest = {
        center: map(next.mouth.rest.center),
        outer: next.mouth.rest.outer.map(map),
        inner: next.mouth.rest.inner.map(map),
      };
    for (const frame of Object.values(next.mouth.frames || {})) {
      if (frame.center) frame.center = map(frame.center);
      if (frame.outer) frame.outer = frame.outer.map(map);
      if (frame.inner) frame.inner = frame.inner.map(map);
    }
    if (next.mouth.maskPolygon)
      next.mouth.maskPolygon = next.mouth.maskPolygon.map(map);
    if (next.mouth.repairMaskPolygon)
      next.mouth.repairMaskPolygon = next.mouth.repairMaskPolygon.map(map);
  }
  if (target === "left" || target === "right") {
    const eye = next.eyes.find((eye) => eye.id === target);
    if (!eye) return next;
    eye.rect = rect;
    eye.aperture = eye.aperture.map(map);
    eye.iris.center = map(eye.iris.center);
    eye.iris.radius = [
      round((eye.iris.radius[0] * rect[2]) / previous[2]),
      round((eye.iris.radius[1] * rect[3]) / previous[3]),
    ];
    if (eye.maskPolygon) eye.maskPolygon = eye.maskPolygon.map(map);
    if (eye.protectedPolygons)
      eye.protectedPolygons = eye.protectedPolygons.map((polygon) =>
        polygon.map(map),
      );
    if (eye.supportRing) eye.supportRing = eye.supportRing.map(map);
    for (const frame of eye.frames || []) {
      if (frame.aperture) frame.aperture = frame.aperture.map(map);
      if (frame.targetAperture)
        frame.targetAperture = frame.targetAperture.map(map);
    }
  }
  if (target === "brows") {
    next.brows.rect = rect;
    next.brows.maskPolygons = next.brows.maskPolygons.map((polygon) =>
      polygon.map(map),
    );
  }
  next.calibrationStatus = "draft";
  return next;
}
function landmarks(recipe: CharacterRecipe, target: Target): Landmark[] {
  const names = [
    "left corner",
    "upper left",
    "top",
    "upper right",
    "right corner",
    "lower right",
    "bottom",
    "lower left",
  ];
  if (target === "head")
    return [
      { key: "pivot", name: "Head pivot", point: recipe.body.head.pivot },
    ];
  if (target === "mouth" && recipe.mouth.rest)
    return [
      { key: "center", name: "Mouth center", point: recipe.mouth.rest.center },
      ...recipe.mouth.rest.outer.map((point, i) => ({
        key: `outer.${i}`,
        name: `Outer lip · ${names[i]}`,
        point,
      })),
      ...recipe.mouth.rest.inner.map((point, i) => ({
        key: `inner.${i}`,
        name: `Inner lip · ${names[i]}`,
        point,
      })),
    ];
  if (target === "left" || target === "right") {
    const eye = recipe.eyes.find((eye) => eye.id === target);
    if (!eye) return [];
    return [
      { key: "iris", name: "Iris center", point: eye.iris.center },
      ...eye.aperture.map((point, i) => ({
        key: `aperture.${i}`,
        name: `Eyelid · ${names[i]}`,
        point,
      })),
      ...(eye.maskPolygon || []).map((point, i) => ({
        key: `mask.${i}`,
        name: `Support mask · ${i + 1}`,
        point,
      })),
    ];
  }
  if (target === "brows")
    return recipe.brows.maskPolygons.flatMap((polygon, i) =>
      polygon.map((point, j) => ({
        key: `brow.${i}.${j}`,
        name: `Brow ${i + 1} · point ${j + 1}`,
        point,
      })),
    );
  return [];
}
function changeLandmark(
  recipe: CharacterRecipe,
  target: Target,
  key: string,
  point: Point,
): CharacterRecipe {
  const next = clone(recipe),
    [kind, first, second] = key.split(".");
  if (target === "head") next.body.head.pivot = point;
  if (target === "mouth" && next.mouth.rest) {
    if (kind === "center") next.mouth.rest.center = point;
    if (kind === "outer" || kind === "inner")
      next.mouth.rest[kind][Number(first)] = point;
  }
  if (target === "left" || target === "right") {
    const eye = next.eyes.find((eye) => eye.id === target);
    if (!eye) return next;
    if (kind === "iris") eye.iris.center = point;
    if (kind === "aperture") eye.aperture[Number(first)] = point;
    if (kind === "mask" && eye.maskPolygon)
      eye.maskPolygon[Number(first)] = point;
  }
  if (target === "brows" && kind === "brow")
    next.brows.maskPolygons[Number(first)][Number(second)] = point;
  next.calibrationStatus = "draft";
  return next;
}
function NumericField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="rb-number">
      <span>{label}</span>
      <input
        type="number"
        value={round(value)}
        min={min}
        max={max}
        step="0.1"
        onChange={(event) => {
          const value = event.target.valueAsNumber;
          if (Number.isFinite(value)) onChange(value);
        }}
      />
    </label>
  );
}
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read this file."));
    reader.readAsDataURL(file);
  });
}
async function responseData(response: Response) {
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data.error === "string"
        ? data.error
        : data.error?.message ||
            data.message ||
            "The studio could not complete this request.",
    );
  return data;
}

export function RigBuilder({ characters = [], onCharacter, onNotice }: Props) {
  const [step, setStep] = useState(0);
  const [recipe, setRecipe] = useState<CharacterRecipe>();
  const [assets, setAssets] = useState<AssetMap>({});
  const [name, setName] = useState("");
  const [provenance, setProvenance] = useState({
    name: "",
    url: "",
    creator: "",
    license: "",
  });
  const [target, setTarget] = useState<Target>("face");
  const [pointKey, setPointKey] = useState("");
  const [zoomFace, setZoomFace] = useState(false);
  const [showOverlays, setShowOverlays] = useState(true);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState("");
  const [built, setBuilt] = useState(false);
  const [serverWarnings, setServerWarnings] = useState<string[]>([]);
  const [registrationResults, setRegistrationResults] = useState<
    RegistrationResult[]
  >([]);
  const [advanced, setAdvanced] = useState("");
  const svgRef = useRef<SVGSVGElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const drag = useRef<
    | {
        recipe: CharacterRecipe;
        start: Point;
        target: Target;
        kind: "move" | "resize" | "point";
        key?: string;
      }
    | undefined
  >(undefined);
  const saveWarningShown = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      const draft = saved.recipe as CharacterRecipe;
      if (
        draft?.schemaVersion !== 1 ||
        !draft.mouth?.rect ||
        draft.eyes?.length !== 2 ||
        !draft.body?.head ||
        !draft.sheets?.gaze ||
        !saved.assets?.source?.width
      )
        return;
      setRecipe(draft);
      setAssets(saved.assets);
      setName(draft.character.name);
      setProvenance({
        name: "",
        url: "",
        creator: "",
        license: "",
        ...draft.provenance,
      });
      setStep(Math.max(0, Math.min(3, Number(saved.step) || 0)));
      setBuilt(!!saved.built);
      if (Array.isArray(saved.registrationResults))
        setRegistrationResults(saved.registrationResults);
    } catch {
      setError(
        "The saved workshop draft could not be read. Import a recipe backup or start with a new portrait.",
      );
    }
  }, []);
  useEffect(() => {
    if (!recipe || !assets.source) return;
    try {
      localStorage.setItem(
        draftStorageKey,
        JSON.stringify({ recipe, assets, step, built, registrationResults }),
      );
    } catch {
      if (!saveWarningShown.current) {
        saveWarningShown.current = true;
        setError(
          "Automatic draft saving is unavailable. Use Save recipe to keep a backup before leaving the workshop.",
        );
      }
    }
  }, [recipe, assets, step, built, registrationResults]);
  const source = assets.source;
  // Building into an existing character adds one expression; its other poses stay as they are.
  const expressionTargets = characters.filter((item) => BUILD_ID.test(item.id));
  const existingCharacter = recipe
    ? expressionTargets.find((item) => item.id === recipe.character.id)
    : undefined;
  const duplicateExpression = !!existingCharacter?.poses.some(
    (pose) => pose.id === recipe?.pose.id,
  );
  function setExpressionTarget(characterId: string) {
    if (!recipe) return;
    const next = clone(recipe);
    const target = expressionTargets.find((item) => item.id === characterId);
    if (target) {
      next.character = {
        ...next.character,
        id: target.id,
        name: target.name,
        color: target.color,
      };
      const used = new Set(target.poses.map((pose) => pose.id));
      let poseId = slug(
        next.pose.name === "Default" ? "expression" : next.pose.name,
      );
      for (let index = 2; used.has(poseId); index++)
        poseId = `${slug(next.pose.name)}-${index}`;
      next.pose = {
        id: poseId,
        name: next.pose.name === "Default" ? "New expression" : next.pose.name,
      };
      next.pack = {
        id: `${target.id}-${poseId}`.slice(0, 64),
        name: `${target.name} · ${next.pose.name}`,
      };
    } else {
      const fresh = slug(name || next.character.name);
      next.character = { ...next.character, id: fresh };
      next.pack = {
        id: fresh,
        name: `${name || next.character.name} character pack`,
      };
      next.pose = { id: `${fresh}_default`, name: "Default" };
    }
    update(next);
  }
  const validation = useMemo(
    () =>
      recipe
        ? validateRecipe(recipe, source)
        : { valid: false, errors: [], warnings: [] },
    [recipe, source],
  );
  const points = recipe ? landmarks(recipe, target) : [];
  const activePoint =
    points.find((point) => point.key === pointKey) || points[0];
  const selectedRect = recipe && getRect(recipe, target);
  const sheetCount = (Object.keys(sheetInfo) as Sheet[]).filter(
    (sheet) => assets[sheet] && recipe?.sheets[sheet].asset,
  ).length;
  function update(next: CharacterRecipe) {
    next.calibrationStatus = "draft";
    setRecipe(next);
    setBuilt(false);
    setServerWarnings([]);
    setRegistrationResults([]);
  }
  async function upload(file: File | undefined, kind: "source" | Sheet) {
    if (!file) return;
    setError("");
    setBusy(kind);
    try {
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
        throw new Error("Choose a PNG, JPEG, or WebP image.");
      if (file.size > 12 * 1024 * 1024)
        throw new Error(
          "This image is too large. Export an image smaller than 12 MB.",
        );
      const health = await getHealth();
      const asset: Asset = await responseData(
        await fetch("/api/characters/assets", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Studio-Token": health.sessionToken,
          },
          body: JSON.stringify({
            dataUrl: await readFile(file),
            name: file.name,
          }),
        }),
      );
      if (kind === "source") {
        const displayName =
          name.trim() ||
          file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
        const next = preparedDraft({
          packId: slug(displayName),
          characterName: displayName,
          sourceAsset: asset.assetId,
          width: asset.width,
          height: asset.height,
        });
        next.provenance = { ...provenance, name: provenance.name || file.name };
        setName(displayName);
        setProvenance(next.provenance as typeof provenance);
        setAssets({ source: asset });
        update(next);
        setTarget("face");
        setPointKey("");
      } else if (recipe) {
        const next = clone(recipe);
        if (next.sheets[kind].asset !== asset.assetId)
          delete next.sheets[kind].registrations;
        next.sheets[kind].asset = asset.assetId;
        setAssets((previous) => ({ ...previous, [kind]: asset }));
        update(next);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Image upload failed.");
    } finally {
      setBusy(undefined);
    }
  }
  function rename(value: string) {
    setName(value);
    if (recipe) {
      const next = clone(recipe);
      next.character.name = value;
      next.pack.name = `${value} character pack`;
      update(next);
    }
  }
  function setSourceInfo(key: keyof typeof provenance, value: string) {
    const info = { ...provenance, [key]: value };
    setProvenance(info);
    if (recipe) {
      const next = clone(recipe);
      next.provenance = info;
      update(next);
    }
  }
  function estimate() {
    if (!source || !recipe) return;
    const next = preparedDraft({
      packId: recipe.pack.id,
      characterName: recipe.character.name,
      sourceAsset: recipe.source,
      width: source.width,
      height: source.height,
      face: recipe.sheets.mouth.referenceRect,
      sheets: Object.fromEntries(
        Object.entries(recipe.sheets).map(([key, sheet]) => [key, sheet.asset]),
      ),
    });
    next.provenance = recipe.provenance;
    next.character = recipe.character;
    next.pack = recipe.pack;
    next.pose = recipe.pose;
    next.autoRegister = recipe.autoRegister;
    update(next);
    setTarget("mouth");
    setPointKey("center");
    onNotice(
      "Draft landmarks reset to your face reference. Adjust them against the original artwork.",
    );
  }
  function sourcePoint(
    event: ReactPointerEvent<SVGSVGElement | SVGElement>,
  ): Point | undefined {
    const transform = svgRef.current?.getScreenCTM();
    if (!transform || !source) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      transform.inverse(),
    );
    return [
      round(Math.max(0, Math.min(source.width, point.x))),
      round(Math.max(0, Math.min(source.height, point.y))),
    ];
  }
  function startDrag(
    event: ReactPointerEvent<SVGElement>,
    selected: Target,
    kind: "move" | "resize" | "point",
    key?: string,
  ) {
    if (!recipe || busy) return;
    const point = sourcePoint(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    setTarget(selected);
    if (key) setPointKey(key);
    drag.current = {
      recipe: clone(recipe),
      start: point,
      target: selected,
      kind,
      key,
    };
    svgRef.current?.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: ReactPointerEvent<SVGSVGElement>) {
    const moving = drag.current,
      current = sourcePoint(event);
    if (!moving || !current || !source) return;
    if (moving.kind === "point" && moving.key) {
      update(changeLandmark(moving.recipe, moving.target, moving.key, current));
      return;
    }
    const previous = getRect(moving.recipe, moving.target);
    if (!previous) return;
    const dx = current[0] - moving.start[0],
      dy = current[1] - moving.start[1];
    const next: Rect =
      moving.kind === "move"
        ? [
            Math.max(0, Math.min(source.width - previous[2], previous[0] + dx)),
            Math.max(
              0,
              Math.min(source.height - previous[3], previous[1] + dy),
            ),
            previous[2],
            previous[3],
          ]
        : [
            previous[0],
            previous[1],
            Math.max(2, Math.min(source.width - previous[0], previous[2] + dx)),
            Math.max(
              2,
              Math.min(source.height - previous[1], previous[3] + dy),
            ),
          ];
    update(changeRect(moving.recipe, moving.target, next.map(round) as Rect));
  }
  function editRect(index: number, value: number) {
    if (!recipe || !selectedRect) return;
    const next = [...selectedRect] as Rect;
    next[index] = value;
    update(changeRect(recipe, target, next));
  }
  function downloadRecipe() {
    if (!recipe) return;
    const blob = new Blob(
      [
        JSON.stringify(
          { format: "frame-rig-backup", version: 1, recipe, assets },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const href = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = href;
    link.download = `${recipe.character.id}-rig-recipe.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
    onNotice(
      "Recipe backup downloaded. Keep your source and edited sheets alongside it.",
    );
  }
  async function importRecipe(file: File | undefined) {
    if (!file) return;
    setBusy("import");
    setError("");
    try {
      if (file.size > 1024 * 1024)
        throw new Error("Choose a recipe JSON smaller than 1 MB.");
      const input = JSON.parse(await file.text());
      const imported =
        input.format === "frame-rig-backup" ? input.recipe : input;
      const result = validateRecipe(imported);
      const structuralErrors = result.errors.filter(
        (message) => !message.includes("sheet needs an uploaded asset"),
      );
      if (structuralErrors.length)
        throw new Error(
          `This recipe needs correction: ${structuralErrors.slice(0, 3).join(" ")}`,
        );
      const recovered: AssetMap = {};
      for (const kind of [
        "source",
        "mouth",
        "blink",
        "brows",
        "gaze",
      ] as const) {
        const id =
          kind === "source" ? imported.source : imported.sheets[kind].asset;
        if (!id) continue;
        const response = await fetch(
          `/api/characters/assets/${encodeURIComponent(id)}`,
        );
        if (response.ok) recovered[kind] = await response.json();
        else if (kind === "source")
          throw new Error(
            "The original source asset is unavailable on this studio. Recipe backups use locally stored assets; restore them on the original machine or upload the original portrait to start a new recipe.",
          );
      }
      if (!recovered.source)
        throw new Error("The recipe has no readable source portrait.");
      setRecipe(imported);
      setAssets(recovered);
      setName(imported.character.name);
      setProvenance({
        name: "",
        url: "",
        creator: "",
        license: "",
        ...imported.provenance,
      });
      setBuilt(false);
      setRegistrationResults([]);
      setStep(1);
      setTarget("face");
      setPointKey("");
      onNotice(
        "Recipe restored. Review calibration and re-upload any missing edited sheets.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not import this recipe.",
      );
    } finally {
      setBusy(undefined);
    }
  }
  async function build() {
    if (
      !recipe ||
      !validation.valid ||
      recipe.calibrationStatus !== "reviewed" ||
      busy
    )
      return;
    setBusy("build");
    setError("");
    setServerWarnings([]);
    try {
      const health = await getHealth();
      const result = await responseData(
        await fetch("/api/characters/build", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Studio-Token": health.sessionToken,
          },
          body: JSON.stringify({ recipe }),
        }),
      );
      if (!result.character?.poses?.length)
        throw new Error(
          "The pack was built but returned no playable character.",
        );
      const registration = Array.isArray(result.validation?.registration)
        ? result.validation.registration
        : [];
      const effectiveRecipe =
        result.recipe?.schemaVersion === 1 &&
        result.recipe.source === recipe.source
          ? (result.recipe as CharacterRecipe)
          : recipe;
      setRecipe(effectiveRecipe);
      setBuilt(true);
      setServerWarnings(result.validation?.warnings || []);
      setRegistrationResults(registration);
      // The parent may navigate away as soon as the character is added.
      try {
        localStorage.setItem(
          draftStorageKey,
          JSON.stringify({
            recipe: effectiveRecipe,
            assets,
            step: 3,
            built: true,
            registrationResults: registration,
          }),
        );
      } catch {
        /* The explicit backup remains available. */
      }
      onCharacter(result.character);
      onNotice(
        `${result.character.name} added to your library. Preview the complete performance in Character lab.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Character build failed.",
      );
    } finally {
      setBusy(undefined);
    }
  }
  async function copyBrief(sheet: Sheet) {
    if (!recipe) return;
    const [x, y, width, height] = recipe.sheets[sheet].referenceRect;
    const text = `Edit the supplied original artwork for ${recipe.character.name}. Do not redesign or generate a new character.\n\nReference crop in original source pixels: x=${x}, y=${y}, width=${width}, height=${height}. Every cell must show this same crop, in the same scale and alignment. Use an evenly divided ${sheetInfo[sheet].grid} sheet with no labels, borders, margins or gutters.\n\n${sheetInfo[sheet].brief}\n\nKeep all areas outside the intended feature unchanged. Save the edited sheet as PNG, JPEG or WebP, under 12 MB. Retain the editable master separately.`;
    try {
      await navigator.clipboard.writeText(text);
      onNotice(`${sheetInfo[sheet].title} edit brief copied.`);
    } catch {
      setError(
        "Clipboard access is unavailable. Copy the visible edit brief manually.",
      );
    }
  }
  function alignmentControl(current: CharacterRecipe) {
    return (
      <div className="rb-alignment">
        <label>
          <input
            type="checkbox"
            checked={!!current.autoRegister}
            onChange={(event) => {
              const next = clone(current);
              next.autoRegister = event.target.checked;
              next.registrationRegion ||= registrationFor(
                next.sheets.mouth.referenceRect,
              );
              update(next);
            }}
          />
          <span>
            Automatically align edited sheets
            <small>
              Match each cell to an unchanged detail in the original.
              Recommended when edits shift the face slightly.
            </small>
          </span>
        </label>
        <p>
          {current.autoRegister
            ? "Review the alignment patch over the nose or bridge. Avoid eyes, brows, mouth, and other edited areas. A weak match stops the build for correction."
            : "Without automatic alignment, sheets must already match the face reference or have manual registration anchors."}
        </p>
        {step === 3 && (
          <button
            className="text-button"
            onClick={() => {
              setStep(1);
              setTarget("registration");
              setPointKey("");
            }}
          >
            <ScanFace size={13} /> Adjust alignment patch
          </button>
        )}
      </div>
    );
  }
  const face = recipe?.sheets.mouth.referenceRect;
  const view =
    source && face && zoomFace
      ? [
          Math.max(0, face[0] - face[2] * 0.08),
          Math.max(0, face[1] - face[3] * 0.08),
          Math.min(source.width, face[2] * 1.16),
          Math.min(source.height, face[3] * 1.16),
        ]
      : [0, 0, source?.width || 1, source?.height || 1];
  const handleSize = view[2] / 80;
  const readySteps = [!!source, !!source, !!source, !!source];
  return (
    <div className="rig-builder">
      <div className="page-heading rb-heading">
        <div>
          <div className="eyebrow">
            <span className="live-dot" /> CHARACTER WORKSHOP
          </div>
          <h1>
            From artwork to <span>character.</span>
          </h1>
          <p>
            Keep the original. Give every expression its own place to move. Your
            draft saves on this device.
          </p>
        </div>
        <div className="rb-backup-actions">
          <button
            className="button"
            onClick={() => importRef.current?.click()}
            disabled={!!busy}
          >
            <Upload size={14} /> Import recipe
          </button>
          <button
            className="button"
            onClick={downloadRecipe}
            disabled={!recipe || !!busy}
          >
            <Download size={14} /> Save recipe
          </button>
          <input
            ref={importRef}
            type="file"
            accept=".json,application/json"
            className="rb-file"
            aria-label="Import rig recipe JSON"
            onChange={(event) => {
              void importRecipe(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
      </div>
      <nav className="rb-steps" aria-label="Character authoring steps">
        {[
          "Original artwork",
          "Calibrate features",
          "Edited sheets",
          "Build character",
        ].map((label, index) => (
          <button
            key={label}
            className={step === index ? "active" : ""}
            aria-current={step === index ? "step" : undefined}
            disabled={(index > 0 && !readySteps[index]) || !!busy}
            onClick={() => setStep(index)}
          >
            <span>{index < step ? <Check size={14} /> : `0${index + 1}`}</span>
            <strong>{label}</strong>
            {index < 3 && <ArrowRight size={14} className="rb-step-arrow" />}
          </button>
        ))}
      </nav>
      <fieldset className="rb-workspace" disabled={!!busy}>
        {error && (
          <div className="rb-error" role="alert">
            <CircleAlert size={17} />
            <p>{error}</p>
            <button className="text-button" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
        {step === 0 && (
          <div className="rb-source-layout">
            <section className="rb-card rb-source-card">
              <div className="rb-section-title">
                <span className="rb-kicker">THE IMMUTABLE ORIGINAL</span>
                <h2>A familiar face, ready to come alive.</h2>
                <p>
                  Start with a portrait you already have. Use a clear front or
                  three-quarter view with visible eyes and mouth.
                </p>
              </div>
              <label className={`rb-upload-source ${source ? "has-art" : ""}`}>
                {source ? (
                  <img src={source.src} alt={`Original artwork for ${name}`} />
                ) : (
                  <div className="rb-empty-art">
                    <ImagePlus size={32} strokeWidth={1.2} />
                    <strong>Choose your original portrait</strong>
                    <span>PNG, JPEG or WebP · up to 12 MB</span>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-label="Upload original portrait"
                  disabled={!!busy}
                  onChange={(event) => {
                    void upload(event.target.files?.[0], "source");
                    event.target.value = "";
                  }}
                />
                {source && (
                  <span className="rb-replace-art">
                    <ImagePlus size={14} /> Replace original & reset calibration
                  </span>
                )}
                {busy === "source" && (
                  <span className="rb-upload-progress">
                    <LoaderCircle className="spin" size={22} /> Reading
                    portrait…
                  </span>
                )}
              </label>
              <div className="rb-source-caption">
                <span>
                  {source
                    ? `${source.width} × ${source.height}px · ${(source.bytes / 1024 / 1024).toFixed(1)} MB`
                    : "A transparent background works beautifully."}
                </span>
                <span>Original pixels preserved</span>
              </div>
            </section>
            <section className="rb-card rb-source-details">
              <span className="rb-kicker">GIVE IT AN IDENTITY</span>
              <h2>Your character</h2>
              <label className="form-field">
                <span>Character name</span>
                <input
                  value={name}
                  maxLength={100}
                  onChange={(event) => rename(event.target.value)}
                  placeholder="e.g. Nora"
                />
              </label>
              <div className="rb-divider" />
              <h3>Source & credits</h3>
              <p className="rb-muted">
                Keep the artwork’s origin with the character pack.
              </p>
              <label className="form-field">
                <span>Artwork title or filename</span>
                <input
                  value={provenance.name}
                  onChange={(event) =>
                    setSourceInfo("name", event.target.value)
                  }
                  placeholder="Original portrait"
                  maxLength={300}
                />
              </label>
              <label className="form-field">
                <span>Creator / artist</span>
                <input
                  value={provenance.creator}
                  onChange={(event) =>
                    setSourceInfo("creator", event.target.value)
                  }
                  placeholder="Artist credit"
                  maxLength={300}
                />
              </label>
              <label className="form-field">
                <span>Source URL</span>
                <input
                  type="url"
                  value={provenance.url}
                  onChange={(event) => setSourceInfo("url", event.target.value)}
                  placeholder="https://…"
                  maxLength={1000}
                />
              </label>
              <label className="form-field">
                <span>License or usage note</span>
                <input
                  value={provenance.license}
                  onChange={(event) =>
                    setSourceInfo("license", event.target.value)
                  }
                  placeholder="e.g. Original artwork, commissioned for this game"
                  maxLength={1000}
                />
              </label>
              <div className="rb-note">
                <ScanFace size={19} />
                <p>
                  The first landmarks are geometric estimates. You’ll fit them
                  to your character in the next step.
                </p>
              </div>
              <button
                className="button primary rb-next"
                disabled={!source || !name.trim() || !!busy}
                onClick={() => setStep(1)}
              >
                Calibrate features <ArrowRight size={15} />
              </button>
            </section>
          </div>
        )}
        {step === 1 && recipe && source && (
          <div className="rb-calibration-layout">
            <section className="rb-card rb-canvas-card">
              <div className="rb-canvas-toolbar">
                <span>
                  <Move size={14} /> Original portrait
                </span>
                <div>
                  <button
                    className={`button small ${zoomFace ? "primary" : ""}`}
                    aria-pressed={zoomFace}
                    onClick={() => setZoomFace(!zoomFace)}
                  >
                    {zoomFace ? "Full portrait" : "Focus face"}
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      checked={showOverlays}
                      onChange={(event) =>
                        setShowOverlays(event.target.checked)
                      }
                    />{" "}
                    Overlays
                  </label>
                </div>
              </div>
              <div className="rb-canvas">
                <svg
                  ref={svgRef}
                  viewBox={view.join(" ")}
                  preserveAspectRatio="xMidYMid meet"
                  role="img"
                  aria-label="Original portrait with draggable facial calibration regions"
                  onPointerMove={moveDrag}
                  onPointerUp={() => {
                    drag.current = undefined;
                  }}
                  onPointerCancel={() => {
                    drag.current = undefined;
                  }}
                >
                  <image
                    href={source.src}
                    width={source.width}
                    height={source.height}
                  />
                  {showOverlays &&
                    (Object.keys(targetNames) as Target[])
                      .filter((key) => key !== "head" && getRect(recipe, key))
                      .map((key) => {
                        const rect = getRect(recipe, key)!;
                        const selected = target === key;
                        return (
                          <g
                            key={key}
                            className={`rb-region ${selected ? "selected" : ""}`}
                            style={{ color: targetColors[key] }}
                          >
                            <rect
                              x={rect[0]}
                              y={rect[1]}
                              width={rect[2]}
                              height={rect[3]}
                              fill="currentColor"
                              fillOpacity={selected ? 0.07 : 0.025}
                              stroke="currentColor"
                              strokeWidth={selected ? 2 : 1}
                              vectorEffect="non-scaling-stroke"
                              strokeDasharray={selected ? undefined : "5 4"}
                              onPointerDown={(event) =>
                                startDrag(event, key, "move")
                              }
                            />
                            <text
                              x={rect[0]}
                              y={rect[1] - handleSize}
                              fontSize={handleSize * 1.8}
                              fill="currentColor"
                              pointerEvents="none"
                            >
                              {targetNames[key]}
                            </text>
                            {selected && (
                              <rect
                                x={rect[0] + rect[2] - handleSize}
                                y={rect[1] + rect[3] - handleSize}
                                width={handleSize * 2}
                                height={handleSize * 2}
                                fill="currentColor"
                                stroke="white"
                                vectorEffect="non-scaling-stroke"
                                className="rb-resize-handle"
                                onPointerDown={(event) =>
                                  startDrag(event, key, "resize")
                                }
                              />
                            )}
                          </g>
                        );
                      })}
                  {showOverlays && target === "mouth" && recipe.mouth.rest && (
                    <g
                      fill="none"
                      stroke={targetColors.mouth}
                      pointerEvents="none"
                    >
                      {[recipe.mouth.rest.outer, recipe.mouth.rest.inner].map(
                        (polygon, index) => (
                          <polygon
                            key={index}
                            points={polygon
                              .map((point) => point.join(","))
                              .join(" ")}
                            strokeWidth="1"
                            vectorEffect="non-scaling-stroke"
                          />
                        ),
                      )}
                    </g>
                  )}
                  {showOverlays &&
                    (target === "left" || target === "right") &&
                    (() => {
                      const eye = recipe.eyes.find((eye) => eye.id === target);
                      if (!eye) return null;
                      return (
                        <g
                          fill="none"
                          stroke={targetColors[target]}
                          pointerEvents="none"
                        >
                          <polygon
                            points={eye.aperture
                              .map((point) => point.join(","))
                              .join(" ")}
                            strokeWidth="1.5"
                            vectorEffect="non-scaling-stroke"
                          />
                          <ellipse
                            cx={eye.iris.center[0]}
                            cy={eye.iris.center[1]}
                            rx={eye.iris.radius[0]}
                            ry={eye.iris.radius[1]}
                            strokeWidth="1"
                            vectorEffect="non-scaling-stroke"
                          />
                          {eye.maskPolygon && (
                            <polygon
                              points={eye.maskPolygon
                                .map((point) => point.join(","))
                                .join(" ")}
                              strokeWidth="1"
                              strokeDasharray="3 3"
                              vectorEffect="non-scaling-stroke"
                            />
                          )}
                        </g>
                      );
                    })()}
                  {showOverlays &&
                    target === "brows" &&
                    recipe.brows.maskPolygons.map((polygon, index) => (
                      <polygon
                        key={index}
                        points={polygon
                          .map((point) => point.join(","))
                          .join(" ")}
                        fill={targetColors.brows}
                        fillOpacity=".13"
                        stroke={targetColors.brows}
                        strokeWidth="1"
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                      />
                    ))}
                  {showOverlays &&
                    target === "head" &&
                    (
                      [
                        ["Chin", recipe.body.chin],
                        ["Neck", recipe.body.neck],
                        ["Head rigid to", recipe.body.head.rigidUntil],
                        ["Torso anchor", recipe.body.head.anchoredFrom],
                      ] as const
                    ).map(([label, y]) => (
                      <g key={label} pointerEvents="none">
                        <line
                          x1="0"
                          y1={y}
                          x2={source.width}
                          y2={y}
                          stroke={targetColors.head}
                          strokeDasharray="4 4"
                          vectorEffect="non-scaling-stroke"
                        />
                        <text
                          x={handleSize * 2}
                          y={y - handleSize}
                          fill={targetColors.head}
                          fontSize={handleSize * 1.7}
                        >
                          {label}
                        </text>
                      </g>
                    ))}
                  {showOverlays &&
                    [...points]
                      .sort(
                        (a, b) =>
                          Number(a.key === activePoint?.key) -
                          Number(b.key === activePoint?.key),
                      )
                      .map((point) => (
                        <circle
                          key={point.key}
                          data-landmark={point.key}
                          cx={point.point[0]}
                          cy={point.point[1]}
                          r={
                            point.key === activePoint?.key
                              ? handleSize * 0.85
                              : handleSize * 0.6
                          }
                          fill={
                            point.key === activePoint?.key
                              ? "#fff"
                              : targetColors[target]
                          }
                          stroke={
                            point.key === activePoint?.key
                              ? targetColors[target]
                              : "#fff"
                          }
                          strokeWidth="1.5"
                          vectorEffect="non-scaling-stroke"
                          className="rb-landmark"
                          onPointerDown={(event) =>
                            startDrag(event, target, "point", point.key)
                          }
                        >
                          <title>{point.name}</title>
                        </circle>
                      ))}
                </svg>
              </div>
              <div className="rb-canvas-footer">
                <span>
                  Drag a region to move · corner to resize · points to refine
                </span>
                <span>Coordinates in source pixels</span>
              </div>
            </section>
            <aside className="rb-card rb-calibration-controls">
              <span className="rb-kicker">FIT THE RIG TO THE ART</span>
              <h2>Feature calibration</h2>
              <div
                className="rb-feature-tabs"
                role="group"
                aria-label="Select feature"
              >
                {(Object.keys(targetNames) as Target[])
                  .filter((key) => key === "head" || getRect(recipe, key))
                  .map((key) => (
                    <button
                      key={key}
                      aria-pressed={target === key}
                      className={target === key ? "selected" : ""}
                      onClick={() => {
                        setTarget(key);
                        setPointKey("");
                      }}
                    >
                      <i style={{ background: targetColors[key] }} />
                      {targetNames[key]}
                    </button>
                  ))}
              </div>
              <p className="rb-muted">
                {target === "face"
                  ? "Frame the full face. This is the same crop shown in every edited sheet. After fitting it, estimate the feature positions, then adjust each one."
                  : target === "registration"
                    ? "Choose a small, detailed part of the nose or bridge that stays unchanged in every edited cell. This initial box is an estimate: fit and review it before enabling alignment. Keep it inside the face reference."
                    : target === "mouth"
                      ? "Cover the complete lips and corners. Fit the outer and inner contours to the resting mouth; keep a tiny nonzero inner opening for a stable mesh."
                      : target === "brows"
                        ? "Fit each support polygon around its brow’s full movement. Keep eyes and foreground hair outside these masks."
                        : target === "head"
                          ? "Put the head pivot at the neck. The rigid head transitions toward a fixed torso below it."
                          : "Left and right are as seen in the portrait. Fit the aperture to the visible eye, then its iris and support mask. Keep brows and hair outside the support."}
              </p>
              {selectedRect && (
                <div className="rb-number-grid">
                  {["X", "Y", "Width", "Height"].map((label, index) => (
                    <NumericField
                      key={label}
                      label={`${targetNames[target]} ${label}`}
                      value={selectedRect[index]}
                      min={index > 1 ? 1 : 0}
                      onChange={(value) => editRect(index, value)}
                    />
                  ))}
                </div>
              )}
              {target === "registration" && alignmentControl(recipe)}
              {target === "face" && (
                <button className="button rb-estimate" onClick={estimate}>
                  <ScanFace size={15} /> Estimate features from this face
                </button>
              )}
              {points.length > 0 && (
                <div className="rb-point-editor">
                  <label className="form-field">
                    <span>Selected landmark</span>
                    <select
                      value={activePoint?.key}
                      onChange={(event) => setPointKey(event.target.value)}
                    >
                      {points.map((point) => (
                        <option value={point.key} key={point.key}>
                          {point.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  {activePoint && (
                    <div className="rb-number-grid">
                      {[0, 1].map((axis) => (
                        <NumericField
                          key={axis}
                          label={`Landmark ${axis === 0 ? "X" : "Y"}`}
                          value={activePoint.point[axis]}
                          min={0}
                          max={axis === 0 ? source.width : source.height}
                          onChange={(value) => {
                            const point = [...activePoint.point] as Point;
                            point[axis] = value;
                            update(
                              changeLandmark(
                                recipe,
                                target,
                                activePoint.key,
                                point,
                              ),
                            );
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}
              {(target === "left" || target === "right") &&
                recipe.eyes.some((eye) => eye.id === target) && (
                  <div className="rb-number-grid">
                    {[0, 1].map((axis) => (
                      <NumericField
                        key={axis}
                        label={`Iris ${axis === 0 ? "horizontal" : "vertical"} radius`}
                        value={
                          recipe.eyes.find((eye) => eye.id === target)!.iris
                            .radius[axis]
                        }
                        min={0.1}
                        onChange={(value) => {
                          const next = clone(recipe);
                          next.eyes.find(
                            (eye) => eye.id === target,
                          )!.iris.radius[axis] = value;
                          update(next);
                        }}
                      />
                    ))}
                  </div>
                )}
              {target === "head" && (
                <div className="rb-number-grid">
                  {(
                    ["chin", "neck", "rigidUntil", "anchoredFrom"] as const
                  ).map((key) => (
                    <NumericField
                      key={key}
                      label={
                        {
                          chin: "Chin Y",
                          neck: "Neck Y",
                          rigidUntil: "Head rigid to Y",
                          anchoredFrom: "Torso anchor Y",
                        }[key]
                      }
                      value={
                        key === "chin" || key === "neck"
                          ? recipe.body[key]
                          : recipe.body.head[key]
                      }
                      min={0}
                      max={source.height}
                      onChange={(value) => {
                        const next = clone(recipe);
                        if (key === "chin" || key === "neck")
                          next.body[key] = value;
                        else next.body.head[key] = value;
                        update(next);
                      }}
                    />
                  ))}
                </div>
              )}
              <div className="rb-note">
                <CircleAlert size={17} />
                <p>
                  Estimates are a starting point. Inspect each eye, the mouth,
                  brow masks, alignment patch, and head pivot before building.
                </p>
              </div>
              <button
                className="button primary rb-next"
                onClick={() => setStep(2)}
              >
                Prepare edited sheets <ArrowRight size={15} />
              </button>
            </aside>
          </div>
        )}
        {step === 2 && recipe && (
          <>
            <div className="rb-sheets-intro">
              <div>
                <span className="rb-kicker">FOUR SMALL SETS OF EDITS</span>
                <h2>The art behind the movement.</h2>
                <p>
                  Use your preferred editor to make these sheets from the
                  original. Copy an edit brief, keep every cell registered to
                  the face crop, then upload the result. If edited cells drift,
                  enable automatic alignment using a reviewed patch of unchanged
                  nose detail.
                </p>
              </div>
              <div className="rb-reference-pill">
                <ScanFace size={18} />
                <span>
                  Shared face reference
                  <strong>
                    {recipe.sheets.mouth.referenceRect.map(round).join(" · ")}{" "}
                    px
                  </strong>
                  <small>x · y · width · height</small>
                </span>
              </div>
            </div>
            <div className="rb-sheet-grid">
              {(Object.keys(sheetInfo) as Sheet[]).map((sheet) => (
                <section className="rb-card rb-sheet-card" key={sheet}>
                  <div className="rb-sheet-title">
                    <h3>{sheetInfo[sheet].title}</h3>
                    <span>{sheetInfo[sheet].grid} SHEET</span>
                  </div>
                  <label
                    className={`rb-sheet-upload ${assets[sheet] ? "has-art" : ""}`}
                  >
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      aria-label={`Upload ${sheetInfo[sheet].title.toLowerCase()} sheet`}
                      disabled={!!busy}
                      onChange={(event) => {
                        void upload(event.target.files?.[0], sheet);
                        event.target.value = "";
                      }}
                    />
                    {assets[sheet] ? (
                      <img
                        src={assets[sheet]!.src}
                        alt={`${sheetInfo[sheet].title} edit sheet`}
                      />
                    ) : (
                      <div>
                        <ImagePlus size={23} strokeWidth={1.3} />
                        <strong>Upload edited sheet</strong>
                        <span>Same crop in every cell · no gutters</span>
                      </div>
                    )}
                    {busy === sheet && (
                      <span className="rb-upload-progress">
                        <LoaderCircle className="spin" size={20} /> Uploading…
                      </span>
                    )}
                  </label>
                  <div
                    className="rb-sheet-cell-order"
                    style={{
                      gridTemplateColumns: `repeat(${recipe.sheets[sheet].columns}, minmax(0,1fr))`,
                    }}
                  >
                    {sheetInfo[sheet].cells.map((cell, index) => (
                      <span key={cell}>
                        <b>{index + 1}</b>
                        {cell}
                      </span>
                    ))}
                  </div>
                  <details className="rb-brief">
                    <summary>
                      Edit brief <ChevronDown size={13} />
                    </summary>
                    <p>{sheetInfo[sheet].brief}</p>
                  </details>
                  <div className="rb-sheet-footer">
                    <button
                      className="text-button"
                      onClick={() => void copyBrief(sheet)}
                    >
                      <Copy size={13} /> Copy edit brief
                    </button>
                    {assets[sheet] && (
                      <span>
                        <Check size={13} /> {assets[sheet]!.width} ×{" "}
                        {assets[sheet]!.height}
                      </span>
                    )}
                  </div>
                </section>
              ))}
            </div>
            <div className="rb-bottom-action">
              <p>
                <strong>{sheetCount} of 4 sheets ready.</strong> The original
                portrait stays untouched; only calibrated feature regions become
                runtime layers.
              </p>
              <button
                className="button primary"
                disabled={sheetCount !== 4 || !!busy}
                onClick={() => setStep(3)}
              >
                Review & build <ArrowRight size={15} />
              </button>
            </div>
          </>
        )}
        {step === 3 && recipe && (
          <div className="rb-review-layout">
            <section className="rb-card rb-build-card">
              <span className="rb-kicker">A REUSABLE CHARACTER PACK</span>
              <h2>Ready for its first line.</h2>
              <p className="rb-muted">
                Build registered feature layers and a portable animation rig,
                then try dialogue and voice in Character lab.
              </p>
              <div className="rb-build-character">
                {source && <img src={source.src} alt={recipe.character.name} />}
                <div>
                  <strong>{recipe.character.name}</strong>
                  <span>
                    {source?.width} × {source?.height}px original
                  </span>
                  <span>
                    {sheetCount} edited sheets · source-pixel calibration
                  </span>
                </div>
              </div>
              <div className="rb-build-fields">
                <label className="form-field">
                  <span>Add as an expression of</span>
                  <select
                    value={existingCharacter?.id ?? ""}
                    onChange={(event) =>
                      setExpressionTarget(event.target.value)
                    }
                  >
                    <option value="">A new character</option>
                    {expressionTargets.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Expression name</span>
                  <input
                    value={recipe.pose.name}
                    maxLength={140}
                    onChange={(event) => {
                      const next = clone(recipe);
                      next.pose.name = event.target.value;
                      update(next);
                    }}
                  />
                </label>
                <label className="form-field">
                  <span>
                    Expression ID{" "}
                    <small>
                      {duplicateExpression
                        ? "Already used by this character"
                        : "Lowercase letters, numbers, - and _"}
                    </small>
                  </span>
                  <input
                    value={recipe.pose.id}
                    aria-invalid={duplicateExpression}
                    onChange={(event) => {
                      const next = clone(recipe);
                      next.pose.id = event.target.value;
                      update(next);
                    }}
                  />
                </label>
                <label className="form-field">
                  <span>
                    Pack ID <small>Use a new ID for each version</small>
                  </span>
                  <input
                    value={recipe.pack.id}
                    onChange={(event) => {
                      const next = clone(recipe);
                      next.pack.id = event.target.value;
                      update(next);
                    }}
                  />
                </label>
                <label className="form-field">
                  <span>Character ID</span>
                  <input
                    value={recipe.character.id}
                    disabled={!!existingCharacter}
                    onChange={(event) => {
                      const next = clone(recipe);
                      next.character.id = event.target.value;
                      update(next);
                    }}
                  />
                </label>
                <label className="form-field">
                  <span>Character accent</span>
                  <input
                    type="color"
                    value={recipe.character.color}
                    onChange={(event) => {
                      const next = clone(recipe);
                      next.character.color = event.target.value;
                      update(next);
                    }}
                  />
                </label>
              </div>
              {alignmentControl(recipe)}
              <label className="rb-review-check">
                <input
                  type="checkbox"
                  checked={recipe.calibrationStatus === "reviewed"}
                  onChange={(event) =>
                    setRecipe({
                      ...recipe,
                      calibrationStatus: event.target.checked
                        ? "reviewed"
                        : "draft",
                    })
                  }
                />
                <span>
                  I’ve checked the landmarks, feature masks
                  {recipe.autoRegister ? ", and alignment patch" : ""} against
                  the original artwork.
                  <small>
                    This records calibration review. Watch the resulting
                    animation after the build.
                  </small>
                </span>
              </label>
              <button
                className="button primary rb-build-button"
                disabled={
                  !validation.valid ||
                  duplicateExpression ||
                  recipe.calibrationStatus !== "reviewed" ||
                  !!busy ||
                  built ||
                  sheetCount !== 4
                }
                onClick={() => void build()}
              >
                {busy === "build" ? (
                  <LoaderCircle className="spin" size={18} />
                ) : built ? (
                  <Check size={18} />
                ) : (
                  <ScanFace size={18} />
                )}
                {busy === "build"
                  ? "Building character layers…"
                  : built
                    ? "Added to your library"
                    : "Build & add to library"}
              </button>
              {busy === "build" && (
                <p className="rb-muted rb-build-progress" role="status">
                  Registering sheets, packing feature textures, and validating
                  the rig. This can take a minute.
                </p>
              )}
              {built && (
                <p className="inline-success" role="status">
                  <Check size={15} /> Character ready. Open Character lab to
                  inspect speech, blinking, gaze, and body motion.
                </p>
              )}
            </section>
            <aside className="rb-card rb-validation">
              <span className="rb-kicker">BEFORE THE PERFORMANCE</span>
              <h2>Recipe checks</h2>
              <div
                className={`rb-validation-state ${validation.valid ? "valid" : ""}`}
              >
                {validation.valid ? (
                  <Check size={18} />
                ) : (
                  <CircleAlert size={18} />
                )}
                <strong>
                  {validation.valid
                    ? "Recipe structure is valid"
                    : "A few things need attention"}
                </strong>
              </div>
              {validation.errors.length > 0 && (
                <ul className="rb-validation-errors">
                  {validation.errors.map((message, index) => (
                    <li key={index}>{message}</li>
                  ))}
                </ul>
              )}
              <p className="rb-muted">
                Format checks verify the recipe. The finished character still
                needs a visual review at natural speed.
              </p>
              {[...validation.warnings, ...serverWarnings].length > 0 && (
                <details className="rb-check-details">
                  <summary>
                    {validation.warnings.length + serverWarnings.length}{" "}
                    calibration notes <ChevronDown size={14} />
                  </summary>
                  <ul>
                    {[...validation.warnings, ...serverWarnings].map(
                      (message, index) => (
                        <li key={index}>{message}</li>
                      ),
                    )}
                  </ul>
                </details>
              )}
              {registrationResults.length > 0 && (
                <div className="rb-registration-report">
                  <h3>Sheet alignment results</h3>
                  <p className="rb-muted">
                    {registrationResults.length} cells registered
                    {registrationResults.some(
                      (item) => typeof item.correlation === "number",
                    )
                      ? ` · lowest match ${Math.min(...registrationResults.flatMap((item) => (typeof item.correlation === "number" ? [item.correlation] : []))).toFixed(3)}`
                      : ""}
                    . These scores measure unchanged detail, not artistic
                    quality.
                  </p>
                  <details className="rb-check-details">
                    <summary>
                      Per-cell matches <ChevronDown size={14} />
                    </summary>
                    <ul>
                      {registrationResults.map((item, index) => (
                        <li key={index}>
                          {item.sheet} · cell {item.cell + 1}:{" "}
                          {typeof item.correlation === "number"
                            ? `correlation ${item.correlation.toFixed(3)}`
                            : item.method || "registered"}
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>
              )}
              <div className="rb-divider" />
              <h3>Keep a working master</h3>
              <p className="rb-muted">
                Save the recipe, original portrait, and edited sheets. JSON
                backups reference assets on this studio; they do not embed the
                images.
              </p>
              <button className="button rb-save" onClick={downloadRecipe}>
                <Download size={14} /> Download recipe backup
              </button>
              <details
                className="rb-advanced"
                onToggle={(event) => {
                  if (event.currentTarget.open)
                    setAdvanced(JSON.stringify(recipe, null, 2));
                }}
              >
                <summary>
                  Advanced recipe JSON <ChevronDown size={14} />
                </summary>
                <p className="rb-muted">
                  Adjust frame landmarks, support masks, registrations, and
                  motion regions. Apply validates the complete recipe.
                </p>
                <textarea
                  aria-label="Advanced character recipe JSON"
                  value={advanced}
                  spellCheck={false}
                  onChange={(event) => setAdvanced(event.target.value)}
                />
                <button
                  className="button small"
                  disabled={!!busy}
                  onClick={() => {
                    try {
                      const input = JSON.parse(advanced);
                      const result = validateRecipe(input, source);
                      if (!result.valid)
                        throw new Error(result.errors.join(" "));
                      if (input.source !== recipe.source)
                        throw new Error(
                          "Change the source through the original artwork step so its preview stays in sync.",
                        );
                      if (
                        (Object.keys(sheetInfo) as Sheet[]).some(
                          (sheet) =>
                            input.sheets[sheet].asset !==
                            recipe.sheets[sheet].asset,
                        )
                      )
                        throw new Error(
                          "Change edited sheet assets through the Edited sheets step so the preview stays in sync.",
                        );
                      update(input);
                      setName(input.character.name);
                      setProvenance({
                        name: "",
                        url: "",
                        creator: "",
                        license: "",
                        ...input.provenance,
                      });
                      setError("");
                      onNotice(
                        "Recipe changes applied. Review the calibration before building.",
                      );
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Invalid JSON.",
                      );
                    }
                  }}
                >
                  Apply recipe changes
                </button>
              </details>
            </aside>
          </div>
        )}
      </fieldset>
    </div>
  );
}

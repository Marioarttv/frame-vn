import { test } from "node:test";
import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { discoverCharacterLibrary } from "../server/character-library";
import {
  CharacterService,
  imageDimensions,
  type CharacterCompilerInput,
} from "../server/character-service";
import { ApiError } from "../server/voice-service";
import { createDraftRecipe } from "../scripts/character/schema";
import { createStudioApi } from "../server/api";

const character = (id: string, prefix = "/local-packs/test") => ({
  id,
  name: `Character ${id}`,
  color: "#8899aa",
  poses: [{ id: "default", name: "Default", src: `${prefix}/portrait.png` }],
});
async function temporary() {
  const root = await mkdtemp(join(tmpdir(), "frame-character-test-"));
  return { root, close: () => rm(root, { recursive: true, force: true }) };
}
function png(width = 100, height = 100): Buffer {
  const chunk = (name: string, bytes: Buffer) => {
    const body = Buffer.concat([Buffer.from(name), bytes]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    const header = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    header.writeUInt32BE(bytes.length);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, body, checksum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.alloc((width * 4 + 1) * height))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const asDataUrl = (bytes: Buffer) =>
  `data:image/png;base64,${bytes.toString("base64")}`;
async function mockCompiler(input: CharacterCompilerInput): Promise<void> {
  await mkdir(input.outputDirectory, { recursive: true });
  await copyFile(
    input.assetFiles[input.recipe.source as string],
    join(input.outputDirectory, "portrait.png"),
  );
  const id = (input.recipe.character as { id: string }).id;
  const result = character(id, input.urlRoot);
  result.poses[0].id = (input.recipe.pose as { id: string }).id;
  await writeFile(
    join(input.outputDirectory, "catalog.json"),
    JSON.stringify({ characters: [result] }),
  );
}

test("library discovers normalized packs in stable order, deduplicates IDs and isolates malformed catalogs", async () => {
  const f = await temporary(),
    root = join(f.root, "public", "local-packs");
  const pack = async (id: string, value: unknown) => {
    await mkdir(join(root, id), { recursive: true });
    await writeFile(join(root, id, "catalog.json"), JSON.stringify(value));
  };
  try {
    const smiling = character("same", "/local-packs/zulu");
    smiling.poses.push({
      id: "smiling",
      name: "Smiling",
      src: "/local-packs/zulu/smiling.png",
    });
    await pack("zulu", {
      name: "Second",
      characters: [smiling, character("second")],
      backgrounds: [
        { id: "bg", name: "Background", src: "/local-packs/zulu/bg.png" },
      ],
    });
    await pack("alpha", {
      name: "First",
      characters: [character("same"), { id: "broken" }],
    });
    await pack("broken", "not a catalog");
    await writeFile(
      join(f.root, "outside.json"),
      JSON.stringify({ characters: [character("escaped")] }),
    );
    await mkdir(join(root, "escape"));
    await symlink(
      join(f.root, "outside.json"),
      join(root, "escape", "catalog.json"),
    );
    await symlink(join(root, "zulu"), join(root, "symlink-pack"));
    const library = await discoverCharacterLibrary(f.root);
    assert.deepEqual(
      library.characters.map((item) => item.id),
      ["same", "second"],
    );
    assert.deepEqual(
      library.packs.map((item) => item.id),
      ["alpha", "zulu"],
    );
    // A later pack adds new expressions to a shared character; duplicate poses keep the first.
    assert.deepEqual(
      library.characters[0].poses.map((pose) => [pose.id, pose.src]),
      [
        ["default", "/local-packs/test/portrait.png"],
        ["smiling", "/local-packs/zulu/smiling.png"],
      ],
    );
    assert.deepEqual(library.packs[0].characterIds, ["same"]);
    assert.deepEqual(library.packs[1].characterIds, ["same", "second"]);
    assert.equal(library.backgrounds[0].id, "bg");
    assert.equal(library.warnings.length, 4);
    assert.ok(
      library.warnings.some(
        (item) => item.packId === "zulu" && item.message.includes("same ID"),
      ),
    );
  } finally {
    await f.close();
  }
});

test("image uploads preserve original bytes and use content IDs rather than user paths", async () => {
  const f = await temporary(),
    service = new CharacterService({ root: f.root }),
    bytes = png();
  try {
    const first = await service.upload({
      name: "../../outside.png",
      dataUrl: asDataUrl(bytes),
    });
    const second = await service.upload({
      name: "another name",
      dataUrl: asDataUrl(bytes),
    });
    assert.equal(
      first.assetId,
      createHash("sha256").update(bytes).digest("hex"),
    );
    assert.equal(first.assetId, second.assetId);
    assert.deepEqual(
      [first.width, first.height, first.mime],
      [100, 100, "image/png"],
    );
    assert.match(first.src, /^\/character-assets\/[a-f0-9]{64}\.png$/);
    assert.deepEqual(
      await readFile(join(service.assetsDirectory, `${first.assetId}.png`)),
      bytes,
    );
    await assert.rejects(stat(join(f.root, "outside.png")), { code: "ENOENT" });
    await assert.rejects(
      service.upload({ dataUrl: "data:image/svg+xml;base64,PHN2Zz4=" }),
      (error) => error instanceof ApiError && error.code === "invalid_image",
    );
    await assert.rejects(
      service.upload({
        dataUrl: asDataUrl(bytes).replace("image/png", "image/jpeg"),
      }),
      (error) => error instanceof ApiError && error.code === "invalid_image",
    );
    await assert.rejects(
      service.upload({ dataUrl: "https://example.com/image.png" }),
      ApiError,
    );
    const bomb = Buffer.from(bytes);
    bomb.writeUInt32BE(1_000_000, 16);
    assert.throws(() => imageDimensions(bomb, "image/png"), ApiError);
  } finally {
    await f.close();
  }
});

test("character build validates calibration, publishes atomically and refuses existing pack or character IDs", async () => {
  const f = await temporary(),
    bytes = png(),
    service = new CharacterService({ root: f.root, compile: mockCompiler });
  try {
    const asset = await service.upload({ dataUrl: asDataUrl(bytes) });
    const recipe = createDraftRecipe({
      packId: "test-character",
      characterName: "Test character",
      sourceAsset: asset.assetId,
      width: 100,
      height: 100,
      sheets: {
        mouth: asset.assetId,
        blink: asset.assetId,
        brows: asset.assetId,
        gaze: asset.assetId,
      },
    });
    const result = await service.build({ recipe });
    assert.equal(result.character.id, "test-character");
    assert.equal(result.validation.sourceAssetsPreserved, true);
    assert.ok(
      result.validation.warnings.some((message) => message.includes("draft")),
    );
    assert.equal(
      (await discoverCharacterLibrary(f.root)).characters[0].id,
      "test-character",
    );
    assert.deepEqual(
      await readFile(join(service.assetsDirectory, `${asset.assetId}.png`)),
      bytes,
    );
    const saved = JSON.parse(
      await readFile(
        join(
          f.root,
          "public",
          "local-packs",
          "test-character",
          "authoring-recipe.json",
        ),
        "utf8",
      ),
    );
    assert.equal(saved.source, asset.assetId);
    await assert.rejects(
      service.build({ recipe }),
      (error) => error instanceof ApiError && error.code === "pack_exists",
    );
    await assert.rejects(
      service.build({
        recipe: { ...recipe, pack: { ...recipe.pack, id: "other-pack" } },
      }),
      (error) => error instanceof ApiError && error.code === "pose_exists",
    );
    // A new pack can add another expression to the installed character.
    const expression = await service.build({
      recipe: {
        ...recipe,
        pack: { ...recipe.pack, id: "test-character-smiling" },
        pose: { id: "smiling", name: "Smiling" },
      },
    });
    assert.equal(expression.character.poses[0].id, "smiling");
    assert.deepEqual(
      (await discoverCharacterLibrary(f.root)).characters[0].poses.map(
        (pose) => pose.id,
      ),
      [recipe.pose.id, "smiling"],
    );
    await assert.rejects(
      service.build({ recipe: { ...recipe, source: "/etc/passwd" } }),
      (error) => error instanceof ApiError && error.code === "invalid_asset_id",
    );
  } finally {
    await f.close();
  }
});

test("a build lock left by an interrupted server expires, while a live lock still blocks", async () => {
  const f = await temporary(),
    service = new CharacterService({ root: f.root, compile: mockCompiler });
  try {
    const asset = await service.upload({ dataUrl: asDataUrl(png()) });
    const recipe = createDraftRecipe({
      packId: "locked-character",
      characterName: "Locked character",
      sourceAsset: asset.assetId,
      width: 100,
      height: 100,
      sheets: {
        mouth: asset.assetId,
        blink: asset.assetId,
        brows: asset.assetId,
        gaze: asset.assetId,
      },
    });
    const builds = join(f.root, ".studio", "characters", "builds");
    const lock = join(builds, "locked-character.pack.lock");
    await mkdir(builds, { recursive: true });
    await writeFile(lock, "live");
    await assert.rejects(
      service.build({ recipe }),
      (error) =>
        error instanceof ApiError &&
        error.code === "character_build_in_progress",
    );
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(lock, old, old);
    const result = await service.build({ recipe });
    assert.equal(result.character.id, "locked-character");
    await assert.rejects(stat(lock), { code: "ENOENT" });
  } finally {
    await f.close();
  }
});

test("failed character compilation never installs a partial pack and can be corrected locally", async () => {
  const f = await temporary();
  let attempts = 0;
  const service = new CharacterService({
    root: f.root,
    compile: async (input) => {
      if (++attempts === 1) {
        await mkdir(input.outputDirectory);
        throw new Error("incomplete masks");
      }
      await mockCompiler(input);
    },
  });
  try {
    const asset = await service.upload({ dataUrl: asDataUrl(png()) });
    const recipe = createDraftRecipe({
      packId: "repaired-character",
      characterName: "Repaired character",
      sourceAsset: asset.assetId,
      width: 100,
      height: 100,
      sheets: {
        mouth: asset.assetId,
        blink: asset.assetId,
        brows: asset.assetId,
        gaze: asset.assetId,
      },
    });
    await assert.rejects(
      service.build({ recipe }),
      (error) =>
        error instanceof ApiError && error.code === "character_build_failed",
    );
    assert.deepEqual((await discoverCharacterLibrary(f.root)).characters, []);
    const result = await service.build({ recipe });
    assert.equal(result.character.id, "repaired-character");
    assert.equal(attempts, 2);
  } finally {
    await f.close();
  }
});

test("fitted anchors survive installation and registration confidence is returned with the effective recipe", async () => {
  const f = await temporary();
  const service = new CharacterService({
    root: f.root,
    compile: async (input) => {
      await mockCompiler(input);
      const fitted = structuredClone(input.recipe) as unknown as ReturnType<
        typeof createDraftRecipe
      >;
      fitted.sheets.mouth.registrations = {
        "0": {
          sourceAnchors: [
            [1, 1],
            [2, 1],
            [1, 2],
          ],
          portraitAnchors: [
            [40, 45],
            [41, 45],
            [40, 46],
          ],
          maxErrorPixels: 1,
        },
      };
      await writeFile(
        join(input.outputDirectory, "authoring-recipe.json"),
        JSON.stringify(fitted),
      );
      return {
        validation: {
          valid: true,
          warnings: ["Review mouth cell 0: stable-region correlation is 0.87."],
          checks: {
            registration: [
              {
                sheet: "mouth",
                cell: 0,
                correlation: 0.87,
                method: "stable-template-ncc",
                rmsPixels: 0,
                translation: [12, -4],
                scale: 1.01,
              },
            ],
          },
        },
      };
    },
  });
  try {
    const asset = await service.upload({ dataUrl: asDataUrl(png()) });
    const recipe = createDraftRecipe({
      packId: "fitted-character",
      characterName: "Fitted character",
      sourceAsset: asset.assetId,
      width: 100,
      height: 100,
      sheets: {
        mouth: asset.assetId,
        blink: asset.assetId,
        brows: asset.assetId,
        gaze: asset.assetId,
      },
    });
    const result = await service.build({ recipe });
    assert.deepEqual(
      result.recipe.sheets.mouth.registrations?.["0"].portraitAnchors,
      [
        [40, 45],
        [41, 45],
        [40, 46],
      ],
    );
    assert.equal(result.validation.registration[0].correlation, 0.87);
    assert.deepEqual(result.validation.registration[0].translation, [12, -4]);
    assert.ok(
      result.validation.warnings.some((value) => value.includes("0.87")),
    );
    const output = join(f.root, "public/local-packs/fitted-character");
    const saved = JSON.parse(
      await readFile(join(output, "authoring-recipe.json"), "utf8"),
    );
    const submitted = JSON.parse(
      await readFile(join(output, "submitted-recipe.json"), "utf8"),
    );
    assert.ok(saved.sheets.mouth.registrations["0"]);
    assert.equal(submitted.sheets.mouth.registrations, undefined);
    assert.equal(saved.calibrationStatus, "draft");
    assert.equal(
      result.recipeUrl,
      "/local-packs/fitted-character/authoring-recipe.json",
    );
  } finally {
    await f.close();
  }
});

test("automatic compiler output cannot promote draft artwork to visually reviewed", async () => {
  const f = await temporary();
  const service = new CharacterService({
    root: f.root,
    compile: async (input) => {
      await mockCompiler(input);
      await writeFile(
        join(input.outputDirectory, "authoring-recipe.json"),
        JSON.stringify({ ...input.recipe, calibrationStatus: "reviewed" }),
      );
    },
  });
  try {
    const asset = await service.upload({ dataUrl: asDataUrl(png()) });
    const recipe = createDraftRecipe({
      packId: "unreviewed-character",
      characterName: "Unreviewed character",
      sourceAsset: asset.assetId,
      width: 100,
      height: 100,
      sheets: {
        mouth: asset.assetId,
        blink: asset.assetId,
        brows: asset.assetId,
        gaze: asset.assetId,
      },
    });
    await assert.rejects(
      service.build({ recipe }),
      (error) =>
        error instanceof ApiError && error.code === "invalid_character_output",
    );
    assert.deepEqual((await discoverCharacterLibrary(f.root)).characters, []);
  } finally {
    await f.close();
  }
});

test("character HTTP uploads require the local authoring token and restored assets keep a safe preview URL", async () => {
  const f = await temporary(),
    service = new CharacterService({ root: f.root, compile: mockCompiler });
  const api = createStudioApi({ root: f.root, characterService: service });
  const server = createServer((request, response) => {
    void api.handler(request, response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const { sessionToken } = await (await fetch(`${base}/api/health`)).json();
    const bytes = png(),
      body = JSON.stringify({ dataUrl: asDataUrl(bytes), name: "Portrait" });
    const request = (headers: Record<string, string>) =>
      fetch(`${base}/api/characters/assets`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body,
      });
    assert.equal((await request({ origin: base })).status, 403);
    assert.equal(
      (
        await request({
          origin: "https://outside.example",
          "x-studio-token": sessionToken,
        })
      ).status,
      403,
    );
    const response = await request({
      origin: base,
      "x-studio-token": sessionToken,
    });
    assert.equal(response.status, 200);
    const asset = await response.json();
    const restored = await (
      await fetch(`${base}/api/characters/assets/${asset.assetId}`)
    ).json();
    assert.equal(restored.src, asset.src);
    const preview = await fetch(`${base}${asset.src}`);
    assert.equal(preview.status, 200);
    assert.equal(preview.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), bytes);
    assert.equal(
      (await fetch(`${base}/api/characters/assets/not-a-hash`)).status,
      404,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.close();
  }
});

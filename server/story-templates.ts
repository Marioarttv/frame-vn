import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { join, sep } from "node:path";
import { validateDraftProject } from "../src/engine/validation";

export interface StoryTemplate {
  id: string;
  title: string;
  description: string;
  scenes: number;
  pack: string;
  /** Same-origin URL of the project JSON. */
  src: string;
}

const MAX_TEMPLATES = 50;
const MAX_BYTES = 4 * 1024 * 1024;
const NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/;

/**
 * Local packs may ship example stories in `stories/*.json`. They appear as project templates in
 * the studio; like the packs themselves they stay on this machine.
 */
export async function discoverStoryTemplates(
  root: string,
): Promise<{ templates: StoryTemplate[]; warnings: string[] }> {
  const base = join(root, "public", "local-packs");
  const templates: StoryTemplate[] = [];
  const warnings: string[] = [];
  let packs: string[];
  try {
    packs = (await readdir(base, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && NAME.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return { templates, warnings };
  }
  const realBase = await realpath(base);
  for (const pack of packs) {
    let files: string[];
    try {
      files = (await readdir(join(base, pack, "stories")))
        .filter((name) => name.endsWith(".json") && NAME.test(name))
        .sort();
    } catch {
      continue;
    }
    for (const file of files) {
      if (templates.length >= MAX_TEMPLATES) break;
      const path = join(base, pack, "stories", file);
      try {
        const real = await realpath(path);
        if (!real.startsWith(realBase + sep))
          throw new Error("it points outside the local packs");
        if ((await stat(real)).size > MAX_BYTES)
          throw new Error("it is larger than 4 MB");
        const result = validateDraftProject(
          JSON.parse(await readFile(real, "utf8")),
        );
        if (!result.valid)
          throw new Error(result.errors[0]?.message ?? "it is not a valid project");
        templates.push({
          id: `${pack}/${file}`,
          title: result.project.title,
          description: result.project.description,
          scenes: result.project.nodes.length,
          pack,
          src: `/local-packs/${pack}/stories/${file}`,
        });
      } catch (error) {
        warnings.push(
          `Skipped story ${pack}/${file}: ${error instanceof Error ? error.message : "unreadable"}.`,
        );
      }
    }
  }
  return { templates, warnings };
}

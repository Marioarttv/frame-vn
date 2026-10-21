/** Check the tracked/distributed boundary; this supplements review, not a legal opinion. */
import { execFileSync } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const forbidden =
  /(^|\/)(?:\.studio|local-packs|\.release-private|node_modules)(\/|$)|^art\/characters\/[^/]+\/work\//;
const errors = [];
for (const file of tracked) {
  if (forbidden.test(file) || (/^\.env/.test(file) && file !== ".env.example"))
    errors.push(`Private path tracked: ${file}`);
  const bytes = await readFile(file);
  if (bytes.byteLength > 10 * 1024 * 1024)
    errors.push(`Oversized tracked file: ${file}`);
  if (/\.(?:png|gif|jpe?g|webp|woff2)$/.test(file)) continue;
  const text = bytes.toString("utf8");
  if (/\/Users\/|\/home\/[a-z][^ /]+\//i.test(text))
    errors.push(`Machine-specific home path: ${file}`);
  if (
    /(?:gh[pousr]_[A-Za-z0-9]{30,}|sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(
      text,
    )
  )
    errors.push(`Potential secret: ${file}`);
}
const distribution = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.name.startsWith(".") || forbidden.test(file))
      errors.push(`Private distribution path: ${file}`);
    if (entry.isDirectory()) await walk(file);
    else distribution.push(file);
  }
}
try {
  await stat("dist");
  await walk("dist");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
if (errors.length) throw new Error(errors.join("\n"));
console.log(
  `Release boundary passed: ${tracked.length} tracked files; ${distribution.length} distribution files. No flagged paths or secret patterns.`,
);

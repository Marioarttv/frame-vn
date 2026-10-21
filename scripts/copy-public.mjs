import { cp, mkdir } from "node:fs/promises";
await mkdir("dist", { recursive: true });
await cp("public/assets", "dist/assets", {
  recursive: true,
  filter: (source) =>
    !source.split(/[\\/]/).some((part) => part.startsWith(".")),
});
await cp("public/favicon.svg", "dist/favicon.svg");
for (const file of [
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "THIRD_PARTY_LICENSES.txt",
]) {
  await cp(file, `dist/${file}`);
}
console.log(
  "Copied original starter assets. Optional local packs are excluded.",
);

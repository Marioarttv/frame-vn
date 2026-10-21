# Frame

A local React/TypeScript/Vite visual-novel studio with a portable offline player.

- Preserve unrelated work. Keep changes scoped and verify the exact candidate.
- Run `npm test`, `npm run build`, and relevant `npm run test:e2e` flows. Tests must never call paid generation providers. Provider tests use injected transports; browser tests intercept generation.
- Regenerate player bundles with `npm run prebuild`; never hand-edit `*.generated.ts`.
- Test export changes by opening the resulting HTML through `file://` with networking disabled.
- Keep `.studio/`, `public/local-packs/`, environment secrets, media exports, and `.release-private/` out of Git and distributable builds. Public example assets need explicit source and license records.
- Character artwork must be approved before rigging. Preserve originals, calibrate each pose, and inspect actual runtime pixels and natural-speed motion; passing geometry checks is insufficient.
- The local server binds to loopback. Use a separate port for concurrent work and stop task-owned servers after checks.
- Document what passed, what was skipped, and any remaining limitations. Do not present prototypes or technical checks as user design acceptance.

import type { Project } from "./types";
import { prepareExportAssets, type ExportOptions } from "./export-assets";
import { createPlayerDocument } from "../player/document";
import type { RecordConfig } from "../player/runtime";

export type { ExportOptions } from "./export-assets";
export type { RecordConfig } from "../player/runtime";
export { escapeHtml, serializeForHtml } from "../player/document";

/** Produces a single offline-playable document. Missing assets fail the complete export. */
export async function exportStandaloneHtml(
  input: Project,
  options: ExportOptions = {},
): Promise<string> {
  const { project, assets } = await prepareExportAssets(input, options);
  return createPlayerDocument(project, assets, { mode: "export" }, options.styles);
}

/**
 * A self-contained document that plays one route through the story on its own, for the video
 * renderer. It follows `route` at choices and signals completion on `window.FramePlayer`.
 */
export async function exportRecordingHtml(
  input: Project,
  record: RecordConfig,
  options: ExportOptions = {},
): Promise<string> {
  const { project, assets } = await prepareExportAssets(input, options);
  return createPlayerDocument(project, assets, {
    mode: "record",
    startNodeId: record.startNodeId,
    record,
  }, options.styles);
}

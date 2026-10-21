import { EXAMPLE_CAST as cast } from "./example-cast.generated";
import {
  createStarterProject,
  createShowcaseProject,
  type Project,
} from "../engine";

/** Keep the portable schema's minimal template usable without the studio asset library. */
export function withExampleCast(project: Project): Project {
  return {
    ...project,
    characters: project.characters.map((character) => {
      const example = cast.find((c) => c.id === character.id);
      return example
        ? {
            ...character,
            color: example.color,
            poses: example.poses.map((p) => ({ ...p, id: "neutral" })),
          }
        : character;
    }),
  };
}
export const createExampleProject = () =>
  withExampleCast(createStarterProject());
export const createExampleTour = (id?: string) =>
  withExampleCast(createShowcaseProject(id));

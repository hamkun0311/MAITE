import { z } from "zod";
import {imageFramingSchema} from "./framing.ts";

export const compositionSchema = z.object({
  pose: z.string().trim().min(1).max(240).regex(/^[\x20-\x7E]+$/),
  framing: z.string().trim().min(1).max(160).regex(/^[\x20-\x7E]+$/),
}).strict();

export const imageSceneSelectionSchema = z.object({
  framing:imageFramingSchema.optional(),
  castConcepts:z.array(z.string().trim().min(1).max(1000)).max(4).optional(),
  confirmed:z.boolean().optional(),
  targetConfirmed:z.boolean().optional(),
  location:z.string().max(240).optional(),outfit:z.string().max(240).optional(),
  characters:z.array(z.string().min(1).max(80)).max(8),target:z.string().min(1).max(80).optional(),
  profileName:z.string().min(1).max(80),userNames:z.array(z.string().min(1).max(80)).max(4),
}).strict();
export type ImageSceneSelection = z.infer<typeof imageSceneSelectionSchema>;
export const visualRequestSchema = z.object({
  kind: z.enum(["illustration", "outfit"]),
  context: z.string().trim().min(1).max(12000),
  selection:imageSceneSelectionSchema.optional(),
  previousCompositions: z.array(compositionSchema).max(3).optional(),
}).strict();

export function confirmedIllustrationTarget(scene?: z.infer<typeof visualRequestSchema>) {
  return scene?.kind === "illustration" && scene.selection?.confirmed && scene.selection.targetConfirmed ? scene.selection.target?.trim() || undefined : undefined;
}

export function visualInstructions(scene: z.infer<typeof visualRequestSchema>) {
  const context = scene.kind === "illustration"
    ? "Select one moment from the latest completed chapter. Describe its actual location, actions and visible cast."
    : "Use the current dialogue scene. Keep the latest established outfit if only the location changed, and keep the established location if only the outfit changed. Use the reference only for details absent from this scene.";
  return " " + context + " Honor confirmed location, outfit and the selected primary subject. Otherwise focus on the profile character if present, or the present counterpart other than the user. If neither is present, depict the setting. Set characterPresent only if the profile character visibly appears. Apply cast and appearance facts to their named owners and use earlier events only for continuity. Keep the prompt, scene fields and Korean summary consistent. Fill pose and framing from the current scene, respecting explicit user choices.";
}

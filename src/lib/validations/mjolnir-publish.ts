import { z } from "zod";
import {
  MAX_BLUEPRINT_NAME_LENGTH,
  MAX_DESCRIPTION_LENGTH,
} from "@/lib/validations/mjolnir";

export const MAX_PUBLISH_CHANGE_REASON_LENGTH = 2000;

export const publishValidationEvidenceSchema = z.object({
  passed: z.literal(true, {
    errorMap: () => ({ message: "Validation evidence must have passed=true" }),
  }),
  overallMatchRate: z.number().min(0).max(1),
});

export const publishBlueprintSchema = z.object({
  name: z.string().trim().min(1).max(MAX_BLUEPRINT_NAME_LENGTH).optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).nullable().optional(),
  changeReason: z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? undefined : value,
    z.string().trim().max(MAX_PUBLISH_CHANGE_REASON_LENGTH).nullable().optional()
  ),
  status: z.enum(["VALIDATED", "ACTIVE"]).optional(),
  validation: publishValidationEvidenceSchema.optional(),
});

export type PublishBlueprintInput = z.infer<typeof publishBlueprintSchema>;

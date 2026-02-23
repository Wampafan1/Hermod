import { z } from "zod";

export const scheduleFrequencySchema = z.enum([
  "DAILY",
  "WEEKLY",
  "BIWEEKLY",
  "MONTHLY",
  "QUARTERLY",
]);

const recipientSchema = z.object({
  email: z.string().email("Invalid email address"),
  name: z.string().max(100).optional(),
});

export const createScheduleSchema = z
  .object({
    reportId: z.string().min(1, "Report is required"),
    enabled: z.boolean().default(true),
    frequency: scheduleFrequencySchema,
    daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
    dayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
    monthsOfYear: z.array(z.number().int().min(1).max(12)).optional().default([]),
    timeHour: z.number().int().min(0).max(23),
    timeMinute: z.number().int().min(0).max(59),
    timezone: z.string().min(1, "Timezone is required"),
    recipients: z
      .array(recipientSchema)
      .min(1, "At least one recipient is required"),
    emailSubject: z.string().min(1, "Email subject is required").max(500),
    emailBody: z.string().max(5000).default(""),
    emailConnectionId: z.string().min(1, "Email connection is required"),
  })
  .refine(
    (data) => {
      if (
        data.frequency === "WEEKLY" ||
        data.frequency === "BIWEEKLY"
      ) {
        return data.daysOfWeek.length > 0;
      }
      return true;
    },
    { message: "Select at least one day", path: ["daysOfWeek"] }
  )
  .refine(
    (data) => {
      if (
        data.frequency === "MONTHLY" ||
        data.frequency === "QUARTERLY"
      ) {
        return data.dayOfMonth != null;
      }
      return true;
    },
    { message: "Day of month is required", path: ["dayOfMonth"] }
  );

export const updateScheduleSchema = z.object({
  enabled: z.boolean().optional(),
  frequency: scheduleFrequencySchema.optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  dayOfMonth: z.number().int().min(1).max(31).optional().nullable(),
  monthsOfYear: z.array(z.number().int().min(1).max(12)).optional(),
  timeHour: z.number().int().min(0).max(23).optional(),
  timeMinute: z.number().int().min(0).max(59).optional(),
  timezone: z.string().min(1).optional(),
  recipients: z.array(recipientSchema).min(1).optional(),
  emailSubject: z.string().min(1).max(500).optional(),
  emailBody: z.string().max(5000).optional(),
  emailConnectionId: z.string().min(1).optional(),
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;

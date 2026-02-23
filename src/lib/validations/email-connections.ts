import { z } from "zod";

const emailAuthTypeSchema = z.enum(["NONE", "PLAIN", "OAUTH2"]);

export const createEmailConnectionSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(200),
    host: z.string().min(1, "SMTP host is required").max(500),
    port: z.number().int().min(1).max(65535).default(587),
    secure: z.boolean().default(false),
    authType: emailAuthTypeSchema.default("PLAIN"),
    username: z.string().max(500).optional().nullable(),
    password: z.string().max(2000).optional().nullable(),
    fromAddress: z.string().min(1, "From address is required").max(500),
  })
  .refine(
    (data) => {
      if (data.authType === "PLAIN" || data.authType === "OAUTH2") {
        return !!data.username && !!data.password;
      }
      return true;
    },
    {
      message: "Username and password are required for this auth type",
      path: ["username"],
    }
  );

export const updateEmailConnectionSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    host: z.string().min(1).max(500).optional(),
    port: z.number().int().min(1).max(65535).optional(),
    secure: z.boolean().optional(),
    authType: emailAuthTypeSchema.optional(),
    username: z.string().max(500).optional().nullable(),
    password: z.string().max(2000).optional().nullable(),
    fromAddress: z.string().min(1).max(500).optional(),
  });

export type CreateEmailConnectionInput = z.infer<typeof createEmailConnectionSchema>;
export type UpdateEmailConnectionInput = z.infer<typeof updateEmailConnectionSchema>;

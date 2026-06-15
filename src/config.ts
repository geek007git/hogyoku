import "dotenv/config";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("true")
  .transform((value) => value === "true");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4173),
  APP_ORIGIN: z.string().url().default("http://localhost:4173"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: booleanString,
  SESSION_SECRET: z.string().min(32),
  GEMINI_API_KEY: z.string().optional().default(""),
  CHAT_MODEL: z.string().default("gemini-2.5-flash-lite"),
  VISION_MODEL: z.string().default("gemini-2.5-flash-lite"),
  EMBEDDING_MODEL: z.string().default("gemini-embedding-001"),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(1536),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(40),
  LOG_LEVEL: z.string().default("info"),
});

export const config = schema.parse(process.env);
export const isProduction = config.NODE_ENV === "production";

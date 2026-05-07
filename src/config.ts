import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1).optional(),
  LLM_BASE_URL: z.string().url(),
  LLM_API_KEY: z.string().min(1),
  LLM_MODEL: z.string().min(1),
  SMALL_LLM_MODEL: z.string().min(1).optional(),
  DATABASE_PATH: z.string().min(1).default('./data/solecism.sqlite'),
  DATABASE_MAX_BYTES: z.coerce.number().int().positive().default(100 * 1024 * 1024),
});

export interface AppConfig {
  discordToken: string;
  discordClientId: string;
  discordGuildId: string | null;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  smallLlmModel: string;
  databasePath: string;
  databaseMaxBytes: number;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const env = envSchema.parse(source);

  return {
    discordToken: env.DISCORD_TOKEN,
    discordClientId: env.DISCORD_CLIENT_ID,
    discordGuildId: env.DISCORD_GUILD_ID ?? null,
    llmBaseUrl: env.LLM_BASE_URL.replace(/\/$/, ''),
    llmApiKey: env.LLM_API_KEY,
    llmModel: env.LLM_MODEL,
    smallLlmModel: env.SMALL_LLM_MODEL ?? env.LLM_MODEL,
    databasePath: env.DATABASE_PATH,
    databaseMaxBytes: env.DATABASE_MAX_BYTES,
  };
}

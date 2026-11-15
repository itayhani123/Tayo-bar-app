export const aiRequiredEnvironment = ["OPENAI_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY"] as const;
export type AiEnvironmentName = typeof aiRequiredEnvironment[number];
type Environment = Record<string, string | undefined>;

export class AiConfigurationError extends Error {
  constructor(public readonly missing: readonly AiEnvironmentName[]) { super("AI_CONFIGURATION_MISSING"); }
}
export function missingAiEnvironment(env: Environment = process.env): AiEnvironmentName[] {
  return aiRequiredEnvironment.filter(name => !env[name]?.trim());
}
export function aiApiKey(env: Environment = process.env) {
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) throw new AiConfigurationError(["OPENAI_API_KEY"]);
  return key;
}
export function aiModel(env: Environment = process.env) { return env.OPENAI_MODEL?.trim() || "gpt-4.1-mini"; }

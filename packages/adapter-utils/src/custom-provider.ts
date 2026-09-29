/**
 * User-defined model endpoint for open harnesses (Pi, OpenCode).
 *
 * Stored as `adapterConfig.customProvider = { baseUrl, apiFormat }` with the
 * model written as `custom/<model id>`. The endpoint is not a credential, so it
 * stays visible in the agent configuration; the optional API key lives in the
 * `CUSTOM_LLM_API_KEY` env binding (a secret) and is only referenced here via
 * the adapters' `{env:VAR}` placeholder, which they expand server-side.
 */

export const CUSTOM_PROVIDER_ID = "custom";
export const CUSTOM_PROVIDER_API_KEY_ENV = "CUSTOM_LLM_API_KEY";

export const CUSTOM_PROVIDER_API_FORMATS = ["openai", "anthropic"] as const;
export type CustomProviderApiFormat = (typeof CUSTOM_PROVIDER_API_FORMATS)[number];

export const CUSTOM_PROVIDER_ADAPTER_TYPES = ["pi_local", "opencode_local"] as const;

export interface CustomProviderConfig {
  baseUrl: string;
  apiFormat: CustomProviderApiFormat;
}

export function supportsCustomProvider(adapterType: string): boolean {
  return (CUSTOM_PROVIDER_ADAPTER_TYPES as readonly string[]).includes(adapterType);
}

/** Trims and drops trailing slashes; null unless it is an absolute http(s) URL. */
export function normalizeCustomProviderBaseUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

export function parseCustomProviderConfig(raw: unknown): CustomProviderConfig | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const baseUrl = normalizeCustomProviderBaseUrl(record.baseUrl);
  if (!baseUrl) return null;
  const apiFormat = (CUSTOM_PROVIDER_API_FORMATS as readonly unknown[]).includes(record.apiFormat)
    ? (record.apiFormat as CustomProviderApiFormat)
    : "openai";
  return { baseUrl, apiFormat };
}

export function customProviderModelRef(modelId: string): string {
  return `${CUSTOM_PROVIDER_ID}/${modelId.trim()}`;
}

/** The model id when `model` is `custom/<id>`, otherwise null. */
export function customProviderModelId(model: unknown): string | null {
  if (typeof model !== "string") return null;
  const prefix = `${CUSTOM_PROVIDER_ID}/`;
  const trimmed = model.trim();
  if (!trimmed.startsWith(prefix)) return null;
  return trimmed.slice(prefix.length).trim() || null;
}

const API_KEY_PLACEHOLDER = `{env:${CUSTOM_PROVIDER_API_KEY_ENV}}`;

/** Pi `models.json` provider entry. Pi requires an apiKey, so keyless local
 * endpoints get a dummy value, as Pi's docs recommend for Ollama. */
export function buildPiCustomProviderEntry(
  config: CustomProviderConfig,
  hasApiKey: boolean,
): Record<string, unknown> {
  return {
    baseUrl: config.baseUrl,
    api: config.apiFormat === "anthropic" ? "anthropic-messages" : "openai-completions",
    apiKey: hasApiKey ? API_KEY_PLACEHOLDER : "not-needed",
    models: [],
  };
}

/** OpenCode `provider` entry backed by the AI SDK package for the API format. */
export function buildOpenCodeCustomProviderEntry(
  config: CustomProviderConfig,
  hasApiKey: boolean,
): Record<string, unknown> {
  return {
    npm: config.apiFormat === "anthropic" ? "@ai-sdk/anthropic" : "@ai-sdk/openai-compatible",
    name: "Custom",
    options: {
      baseURL: config.baseUrl,
      ...(hasApiKey ? { apiKey: API_KEY_PLACEHOLDER } : {}),
    },
    models: {},
  };
}

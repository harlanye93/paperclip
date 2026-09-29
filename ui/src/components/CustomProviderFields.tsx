import {
  CUSTOM_PROVIDER_API_FORMATS,
  CUSTOM_PROVIDER_API_KEY_ENV,
  CUSTOM_PROVIDER_ID,
  normalizeCustomProviderBaseUrl,
  parseCustomProviderConfig,
  type CustomProviderApiFormat,
} from "@paperclipai/adapter-utils";
import type { AdapterConfigFieldsProps, AdapterConfigSection } from "../adapters/types";
import { DraftInput, Field } from "./agent-config-primitives";

const API_FORMAT_LABELS: Record<CustomProviderApiFormat, string> = {
  openai: "OpenAI Chat Completions",
  anthropic: "Anthropic Messages",
};

export function CustomProviderApiFormatSelect({
  value,
  onChange,
  className,
}: {
  value: CustomProviderApiFormat;
  onChange: (value: CustomProviderApiFormat) => void;
  className?: string;
}) {
  return (
    <select
      aria-label="API format"
      className={className}
      value={value}
      onChange={(event) => onChange(event.target.value as CustomProviderApiFormat)}
    >
      {CUSTOM_PROVIDER_API_FORMATS.map((format) => (
        <option key={format} value={format}>
          {API_FORMAT_LABELS[format]}
        </option>
      ))}
    </select>
  );
}

/**
 * Edit-mode fields for an agent created with a custom endpoint. The model id is
 * edited in the shared model picker (as `custom/<id>`) and the key through the
 * CUSTOM_LLM_API_KEY environment variable, so only the endpoint lives here.
 */
export function CustomProviderConfigFields({
  isCreate,
  config,
  eff,
  mark,
  inputClass,
}: Pick<AdapterConfigFieldsProps, "isCreate" | "config" | "eff" | "mark"> & {
  inputClass: string;
  /** Read by `configFieldsForSection` to place these fields beside the model picker. */
  configSection?: AdapterConfigSection;
}) {
  if (isCreate) return null;
  const current = parseCustomProviderConfig(
    eff("adapterConfig", "customProvider", config.customProvider),
  );
  if (!current) return null;
  return (
    <>
      <Field
        label="Custom endpoint base URL"
        hint={`Pick the model as ${CUSTOM_PROVIDER_ID}/<model id> in the Model field. The API key comes from the ${CUSTOM_PROVIDER_API_KEY_ENV} environment variable.`}
      >
        <DraftInput
          value={current.baseUrl}
          onCommit={(value) => {
            const baseUrl = normalizeCustomProviderBaseUrl(value);
            if (baseUrl) mark("adapterConfig", "customProvider", { ...current, baseUrl });
          }}
          className={inputClass}
          placeholder="https://llm-gateway.example.com/v1"
        />
      </Field>
      <Field label="Custom endpoint API format">
        <CustomProviderApiFormatSelect
          className={inputClass}
          value={current.apiFormat}
          onChange={(apiFormat) =>
            mark("adapterConfig", "customProvider", { ...current, apiFormat })
          }
        />
      </Field>
    </>
  );
}

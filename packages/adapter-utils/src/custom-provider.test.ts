import { describe, expect, it } from "vitest";
import {
  customProviderModelId,
  customProviderModelRef,
  normalizeCustomProviderBaseUrl,
  parseCustomProviderConfig,
  supportsCustomProvider,
} from "./custom-provider.js";

describe("custom provider config", () => {
  it("normalizes http(s) base URLs and rejects everything else", () => {
    expect(normalizeCustomProviderBaseUrl(" https://gw.example.com/v1// ")).toBe("https://gw.example.com/v1");
    expect(normalizeCustomProviderBaseUrl("http://localhost:11434/v1")).toBe("http://localhost:11434/v1");
    for (const bad of ["", "gw.example.com", "ftp://gw", "javascript:alert(1)", 42, null]) {
      expect(normalizeCustomProviderBaseUrl(bad)).toBeNull();
    }
  });

  it("parses the stored config and defaults the API format", () => {
    expect(parseCustomProviderConfig({ baseUrl: "https://gw/v1/" })).toEqual({
      baseUrl: "https://gw/v1",
      apiFormat: "openai",
    });
    expect(parseCustomProviderConfig({ baseUrl: "https://gw/v1", apiFormat: "anthropic" })?.apiFormat).toBe("anthropic");
    expect(parseCustomProviderConfig({ baseUrl: "https://gw/v1", apiFormat: "grpc" })?.apiFormat).toBe("openai");
    expect(parseCustomProviderConfig({ baseUrl: "nope" })).toBeNull();
    expect(parseCustomProviderConfig(null)).toBeNull();
  });

  it("round-trips custom model references", () => {
    expect(customProviderModelRef(" qwen3-coder ")).toBe("custom/qwen3-coder");
    expect(customProviderModelId("custom/org/model:tag")).toBe("org/model:tag");
    expect(customProviderModelId("openrouter/x")).toBeNull();
    expect(customProviderModelId("custom/")).toBeNull();
  });

  it("is limited to open harnesses", () => {
    expect(supportsCustomProvider("pi_local")).toBe(true);
    expect(supportsCustomProvider("opencode_local")).toBe(true);
    for (const adapter of ["codex_local", "claude_local", "cursor", "hermes_local"]) {
      expect(supportsCustomProvider(adapter)).toBe(false);
    }
  });
});

export function normalizeProviderBaseUrl(url: string): string {
  return url
    .replace(/\/+$/, "")
    .replace(/\/embeddings(\/\w+)?$/, "")
    .replace(/\/chat\/completions$/, "")
    .replace(/\/v\d+\/(chat\/completions|embeddings)(\/\w+)?$/, "")
    .replace(/\/v\d+$/, "");
}

export function buildChatCompletionsUrl(base: string): string {
  return `${normalizeProviderBaseUrl(base)}/v1/chat/completions`;
}

export function buildEmbeddingsUrl(base: string): string {
  return `${normalizeProviderBaseUrl(base)}/v1/embeddings`;
}

export function buildModelsUrl(base: string): string {
  return `${normalizeProviderBaseUrl(base)}/v1/models`;
}

export function buildProviderHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  return headers;
}

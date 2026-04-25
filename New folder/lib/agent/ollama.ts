import { getOllamaBaseUrl } from "./models";

type OllamaGenerateParams = {
  model: string;
  system: string;
  prompt: string;
  temperature?: number;
};

type OllamaGenerateFallbackParams = Omit<OllamaGenerateParams, "model"> & {
  models: string[];
};

export type OllamaGenerateResult = {
  model: string;
  response: string;
};

export async function generateWithOllama(params: OllamaGenerateParams) {
  const response = await fetch(`${getOllamaBaseUrl()}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      system: params.system,
      prompt: params.prompt,
      stream: false,
      options: {
        temperature: params.temperature ?? 0.2,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Ollama request failed with status ${response.status}: ${errorText}`
    );
  }

  const data = await response.json();
  return String(data.response ?? "").trim();
}

function formatFallbackErrors(errors: string[]) {
  return errors.join(" | ");
}

function isRetryableOllamaError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  // Retry on: memory pressure, any HTTP error (4xx/5xx — covers 404 model-not-found),
  // network failures. Only break early on truly unexpected non-HTTP errors.
  return /requires more system memory|status [45]\d\d|fetch failed|ECONNRESET|ETIMEDOUT/i.test(
    error.message
  );
}

export async function generateWithOllamaFallback(
  params: OllamaGenerateFallbackParams
): Promise<OllamaGenerateResult> {
  const errors: string[] = [];

  for (const model of params.models) {
    try {
      const response = await generateWithOllama({
        model,
        system: params.system,
        prompt: params.prompt,
        temperature: params.temperature,
      });

      return {
        model,
        response,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown Ollama error";
      errors.push(`${model}: ${message}`);

      if (!isRetryableOllamaError(error)) {
        break;
      }
    }
  }

  throw new Error(formatFallbackErrors(errors));
}

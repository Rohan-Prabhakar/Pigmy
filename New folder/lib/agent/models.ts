export function getOllamaBaseUrl() {
  return process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
}

export function getModelServiceBaseUrl() {
  return process.env.MODEL_SERVICE_URL || "http://127.0.0.1:8000";
}

function dedupeModels(models: Array<string | undefined>) {
  return models.filter((model, index, list): model is string => {
    return Boolean(model) && list.indexOf(model) === index;
  });
}

export function getChatModelCandidates() {
  return dedupeModels([
    process.env.OLLAMA_CHAT_MODEL,
    "qwen2.5:7b-instruct",
    "qwen2.5:latest",
    "qwen2.5:7b",
    "gemma4:latest",
    "llama3.2:3b",
    "llama3.2:1b",
  ]);
}

export function getFastChatModelCandidates() {
  return dedupeModels([
    process.env.OLLAMA_FAST_CHAT_MODEL,
    "llama3.2:1b",
    "llama3.2:3b",
    process.env.OLLAMA_CHAT_MODEL,
    "qwen2.5:latest",
    "qwen2.5:7b",
  ]);
}

export function getDeepChatModelCandidates() {
  return dedupeModels([
    process.env.OLLAMA_TUNED_MODEL,
    "pipeline-qwen-sft",
    process.env.OLLAMA_DEEP_CHAT_MODEL,
    process.env.OLLAMA_CHAT_MODEL,
    "qwen2.5:7b-instruct",
    "qwen2.5:latest",
    "qwen2.5:7b",
    "gemma4:latest",
    "llama3.2:3b",
  ]);
}

export function getRedHerringModelCandidates() {
  return dedupeModels([
    process.env.OLLAMA_TUNED_MODEL,
    "pipeline-qwen-sft",
    process.env.OLLAMA_RED_HERRING_MODEL,
    process.env.OLLAMA_CHAT_MODEL,
    "qwen2.5:7b-instruct",
    "qwen2.5:latest",
    "qwen2.5:7b",
    "gemma4:latest",
    "llama3.2:3b",
    "llama3.2:1b",
  ]);
}

export function getRemedyModelCandidates() {
  return dedupeModels([
    process.env.OLLAMA_REMEDY_MODEL,
    "pipeline-qwen-sft",
    process.env.OLLAMA_TUNED_MODEL,
    "pipeline-qwen-sft",
    process.env.OLLAMA_DEEP_CHAT_MODEL,
    process.env.OLLAMA_CHAT_MODEL,
    "qwen2.5:14b",
    "qwen2.5:7b-instruct",
    "qwen2.5:7b",
    "llama3.2:3b",
  ]);
}

export function getPreferredRemedyModel() {
  return getRemedyModelCandidates()[0] ?? "pipeline-qwen-sft";
}

export function getPreferredChatModel() {
  return getChatModelCandidates()[0] ?? "qwen2.5:7b-instruct";
}

export function getPreferredFastChatModel() {
  return getFastChatModelCandidates()[0] ?? "llama3.2:1b";
}

export function getPreferredDeepChatModel() {
  return getDeepChatModelCandidates()[0] ?? "pipeline-qwen-sft";
}

export function getPreferredRedHerringModel() {
  return getRedHerringModelCandidates()[0] ?? "pipeline-qwen-sft";
}

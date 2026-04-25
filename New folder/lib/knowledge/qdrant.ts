import type { Citation, RetrievedContext } from "@/lib/product/types";

const DEFAULT_COLLECTION = "pipeline_ops_kb";
const APP_NAMESPACE = "pipeline-ops";

type QdrantSearchPayload = {
  documentId?: string;
  title?: string;
  text?: string;
  excerpt?: string;
  tags?: string[];
  tool?: string;
  ruleId?: string;
  dataset?: string;
  owner?: string;
  app?: string;
  sourceType?: string;
};

type QdrantPoint = {
  id: string | number;
  payload?: QdrantSearchPayload;
};

type QdrantScrollResponse = {
  status?: string;
  result?: {
    points?: QdrantPoint[];
  };
};

function getQdrantConfig() {
  const url = process.env.QDRANT_URL?.trim();
  const apiKey = process.env.QDRANT_API_KEY?.trim();
  const collection = process.env.QDRANT_COLLECTION?.trim() || DEFAULT_COLLECTION;

  if (!url || !apiKey) {
    return null;
  }

  return {
    url: url.replace(/\/+$/, ""),
    apiKey,
    collection,
  };
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

function inferToolsFromQuery(query: string) {
  const lowered = query.toLowerCase();
  const tools = ["snowflake", "airflow", "fivetran", "kafka", "looker", "dbt"];
  return tools.filter((tool) => lowered.includes(tool));
}

function scorePoint(query: string, point: QdrantPoint) {
  const payload = point.payload ?? {};
  const haystack = [payload.title, payload.text, payload.excerpt, ...(payload.tags ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const queryTokens = tokenize(query);
  const payloadTokens = tokenize(haystack);

  const overlap = queryTokens.filter((token) => payloadTokens.includes(token)).length;
  const exactScore = queryTokens.reduce(
    (score, token) => (haystack.includes(token) ? score + 1 : score),
    0
  );
  const tagScore = (payload.tags ?? []).reduce(
    (score, tag) => (query.toLowerCase().includes(tag.toLowerCase()) ? score + 0.5 : score),
    0
  );

  return overlap * 2 + exactScore + tagScore;
}

function toCitation(point: QdrantPoint, score: number): Citation | null {
  const payload = point.payload;
  if (!payload?.documentId || !payload?.title) {
    return null;
  }

  return {
    documentId: payload.documentId,
    title: payload.title,
    excerpt: (payload.excerpt ?? payload.text ?? "").slice(0, 220),
    score,
  };
}

export function isQdrantKnowledgeConfigured() {
  return Boolean(getQdrantConfig());
}

export async function retrieveKnowledgeFromQdrant(
  query: string,
  topK = 5
): Promise<RetrievedContext | null> {
  const config = getQdrantConfig();
  if (!config) {
    return null;
  }

  const toolMatches = inferToolsFromQuery(query);
  const must: Array<Record<string, unknown>> = [
    {
      key: "app",
      match: {
        value: APP_NAMESPACE,
      },
    },
  ];

  if (toolMatches.length === 1) {
    must.push({
      key: "tool",
      match: {
        value: toolMatches[0],
      },
    });
  }

  try {
    const response = await fetch(
      `${config.url}/collections/${encodeURIComponent(config.collection)}/points/scroll`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": config.apiKey,
        },
        body: JSON.stringify({
          limit: Math.max(topK * 8, 24),
          with_payload: true,
          with_vector: false,
          filter: {
            must,
          },
        }),
        cache: "no-store",
      }
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as QdrantScrollResponse;
    const points = data.result?.points ?? [];
    const citations = points
      .map((point) => ({ point, score: scorePoint(query, point) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, topK)
      .map(({ point, score }) => toCitation(point, score))
      .filter((citation): citation is Citation => Boolean(citation));

    return {
      query,
      citations,
    };
  } catch {
    return null;
  }
}


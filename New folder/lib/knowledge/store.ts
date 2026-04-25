import { makeId, patchStore, readStore } from "@/lib/platform/json-store";
import type { Citation, KnowledgeChunk, KnowledgeDocument, RetrievedContext } from "@/lib/product/types";
import { retrieveKnowledgeFromQdrant } from "@/lib/knowledge/qdrant";

const KNOWLEDGE_FILE = "knowledge.json";

export type KnowledgeStore = {
  documents: KnowledgeDocument[];
  chunks: KnowledgeChunk[];
};

const seedDocument: KnowledgeDocument = {
  documentId: "workspace-sft-corpus",
  title: "SFT corpus reference",
  sourceType: "sft_corpus",
  text:
    "Workspace contains an SFT training corpus reference. Retrieval should use uploaded documents and any curated SFT excerpts added to the knowledge base.",
  tags: ["sft", "workspace", "global"],
  createdAt: new Date(0).toISOString(),
};

const defaultStore: KnowledgeStore = {
  documents: [seedDocument],
  chunks: [
    {
      chunkId: "workspace-sft-corpus-1",
      documentId: seedDocument.documentId,
      text: seedDocument.text,
      tags: seedDocument.tags,
    },
  ],
};

export function getKnowledgeStore(): KnowledgeStore {
  return readStore<KnowledgeStore>(KNOWLEDGE_FILE, defaultStore);
}

export function saveKnowledgeStore(store: KnowledgeStore) {
  writeStore(KNOWLEDGE_FILE, store);
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter(Boolean);
}

function chunkText(text: string) {
  const segments = text
    .split(/\n{2,}/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (!segments.length) {
    return [text.trim()];
  }

  return segments.flatMap((segment) => {
    if (segment.length <= 500) return [segment];
    const chunks: string[] = [];
    for (let index = 0; index < segment.length; index += 420) {
      chunks.push(segment.slice(index, index + 420));
    }
    return chunks;
  });
}

export function addKnowledgeDocument(input: Omit<KnowledgeDocument, "documentId" | "createdAt">) {
  const document: KnowledgeDocument = {
    documentId: makeId("doc"),
    createdAt: new Date().toISOString(),
    ...input,
  };

  patchStore(KNOWLEDGE_FILE, defaultStore, (store) => {
    const chunks = chunkText(document.text).map((text) => ({
      chunkId: makeId("chunk"),
      documentId: document.documentId,
      text,
      tags: document.tags,
    }));

    return {
      documents: [document, ...store.documents],
      chunks: [...chunks, ...store.chunks],
    };
  });

  return document;
}

function retrieveKnowledgeLocally(query: string, topK = 5): RetrievedContext {
  const store = getKnowledgeStore();
  const queryTokens = tokenize(query);

  const scored = store.chunks
    .map((chunk) => {
      const text = chunk.text.toLowerCase();
      const tokens = tokenize(chunk.text);
      const overlap = queryTokens.filter((token) => tokens.includes(token)).length;
      const exactScore = queryTokens.reduce(
        (score, token) => (text.includes(token) ? score + 1 : score),
        0
      );
      const tagScore = chunk.tags.reduce(
        (score, tag) => (query.toLowerCase().includes(tag.toLowerCase()) ? score + 0.5 : score),
        0
      );

      return {
        chunk,
        score: overlap * 2 + exactScore + tagScore,
      };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);

  const citations: Citation[] = scored.map(({ chunk, score }) => {
    const document = store.documents.find((item) => item.documentId === chunk.documentId);
    return {
      documentId: chunk.documentId,
      title: document?.title ?? "Unknown document",
      excerpt: chunk.text.slice(0, 220),
      score,
    };
  });

  return {
    query,
    citations,
  };
}

export async function retrieveKnowledge(query: string, topK = 5): Promise<RetrievedContext> {
  const remote = await retrieveKnowledgeFromQdrant(query, topK);
  if (remote?.citations.length) {
    return remote;
  }

  return retrieveKnowledgeLocally(query, topK);
}

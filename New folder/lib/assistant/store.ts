import { getMongoDb, isMongoConfigured } from "@/lib/platform/mongo";
import type {
  AssistantApproval,
  AssistantCommandRun,
  AssistantMessageRecord,
  AssistantThread,
} from "@/lib/product/types";

// ─── ID helper ────────────────────────────────────────────────────────────────

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Collections ──────────────────────────────────────────────────────────────

async function threadsCol() {
  const db = await getMongoDb();
  return db.collection<AssistantThread>("assistant_threads");
}

async function approvalsCol() {
  const db = await getMongoDb();
  return db.collection<AssistantApproval>("assistant_approvals");
}

async function commandRunsCol() {
  const db = await getMongoDb();
  return db.collection<AssistantCommandRun>("assistant_command_runs");
}

// ─── Threads ──────────────────────────────────────────────────────────────────

export async function listThreads(): Promise<AssistantThread[]> {
  if (!isMongoConfigured()) return [];
  const col = await threadsCol();
  return col.find({}).sort({ updatedAt: -1 }).limit(50).toArray();
}

export async function getThread(threadId?: string): Promise<AssistantThread | null> {
  if (!threadId || !isMongoConfigured()) return null;
  const col = await threadsCol();
  return col.findOne({ threadId }) ?? null;
}

export async function getLatestThread(): Promise<AssistantThread | null> {
  if (!isMongoConfigured()) return null;
  const col = await threadsCol();
  return col.find({}).sort({ updatedAt: -1 }).limit(1).next();
}

export async function createThread(params?: {
  title?: string;
  selectedConnectionId?: string;
}): Promise<AssistantThread> {
  const now = new Date().toISOString();
  const thread: AssistantThread = {
    threadId: makeId("thread"),
    title: params?.title ?? "New thread",
    selectedConnectionId: params?.selectedConnectionId,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  if (isMongoConfigured()) {
    const col = await threadsCol();
    await col.insertOne({ ...thread });
  }
  return thread;
}

export async function ensureThread(params?: {
  threadId?: string;
  title?: string;
  selectedConnectionId?: string;
}): Promise<AssistantThread> {
  const existing = params?.threadId
    ? await getThread(params.threadId)
    : await getLatestThread();
  if (existing) return existing;
  return createThread(params);
}

export async function deleteThread(threadId: string): Promise<void> {
  if (!isMongoConfigured()) return;
  const col = await threadsCol();
  await col.deleteOne({ threadId });
}

export async function appendMessages(
  threadId: string,
  messages: Array<Omit<AssistantMessageRecord, "messageId" | "createdAt">>
): Promise<AssistantMessageRecord[]> {
  const createdMessages: AssistantMessageRecord[] = messages.map((m) => ({
    messageId: makeId("msg"),
    createdAt: new Date().toISOString(),
    ...m,
  }));

  if (isMongoConfigured()) {
    const col = await threadsCol();
    const thread = await col.findOne({ threadId });
    const autoTitle =
      thread?.title === "New thread" && createdMessages[0]?.role === "user"
        ? createdMessages[0].text.slice(0, 48)
        : thread?.title ?? "New thread";

    await col.updateOne(
      { threadId },
      {
        $push: { messages: { $each: createdMessages } } as never,
        $set: { updatedAt: new Date().toISOString(), title: autoTitle },
      }
    );
  }

  return createdMessages;
}

export async function updateMessageMetadata(
  threadId: string,
  messageId: string,
  metadata: AssistantMessageRecord["metadata"]
): Promise<void> {
  if (!isMongoConfigured()) return;
  const col = await threadsCol();
  await col.updateOne(
    { threadId, "messages.messageId": messageId },
    { $set: { "messages.$.metadata": metadata, updatedAt: new Date().toISOString() } }
  );
}

// ─── Approvals ────────────────────────────────────────────────────────────────

export async function storeApproval(
  input: Omit<AssistantApproval, "approvalId" | "createdAt">
): Promise<AssistantApproval> {
  const approval: AssistantApproval = {
    approvalId: makeId("approval"),
    createdAt: new Date().toISOString(),
    ...input,
  };
  if (isMongoConfigured()) {
    const col = await approvalsCol();
    await col.insertOne({ ...approval });
  }
  return approval;
}

// ─── Command runs ─────────────────────────────────────────────────────────────

export async function storeCommandRun(
  input: Omit<AssistantCommandRun, "runId" | "executedAt">
): Promise<AssistantCommandRun> {
  const run: AssistantCommandRun = {
    runId: makeId("cmd"),
    executedAt: new Date().toISOString(),
    ...input,
  };
  if (isMongoConfigured()) {
    const col = await commandRunsCol();
    await col.insertOne({ ...run });
  }
  return run;
}

import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI?.trim();
const dbName = process.env.MONGODB_DB?.trim() || "pipeline_ops";

let clientPromise: Promise<MongoClient> | null = null;

export function isMongoConfigured() {
  return Boolean(uri);
}

async function getMongoClient() {
  if (!uri) {
    throw new Error("MONGODB_URI is not configured.");
  }

  if (!clientPromise) {
    const client = new MongoClient(uri);
    clientPromise = client.connect();
  }

  return clientPromise;
}

export async function getMongoDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(dbName);
}

// ─── Agent step tracking ──────────────────────────────────────────────────────

export async function setAgentStep(threadId: string, step: string) {
  if (!uri) return;
  const db = await getMongoDb();
  await db.collection("agent_steps").updateOne(
    { threadId },
    { $set: { threadId, step, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
}

export async function getAgentStep(threadId: string): Promise<string | null> {
  if (!uri) return null;
  const db = await getMongoDb();
  const doc = await db.collection<{ step: string }>("agent_steps").findOne({ threadId });
  return doc?.step ?? null;
}

export async function clearAgentStep(threadId: string) {
  if (!uri) return;
  const db = await getMongoDb();
  await db.collection("agent_steps").deleteOne({ threadId });
}

export async function readMongoState<T>(key: string) {
  const db = await getMongoDb();
  const document = await db
    .collection<{ _id: string; payload: T }>("app_state")
    .findOne({ _id: key });
  return document?.payload ?? null;
}

export async function writeMongoState<T>(key: string, payload: T) {
  const db = await getMongoDb();
  await db.collection<{ _id: string; payload: T; updatedAt: string }>("app_state").updateOne(
    { _id: key },
    {
      $set: {
        payload,
        updatedAt: new Date().toISOString(),
      },
    },
    { upsert: true }
  );
}

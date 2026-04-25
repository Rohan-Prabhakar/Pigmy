import { findConnectorProfile } from "./catalog";
import { getConnectionGuidance, getVisibleConnectionFields } from "./connection-guidance";
import { buildSnapshotFromInspect, resolveAdapterRecord, validateConnectionRequest } from "./adapters";
import { identifyPipelineFromConnection } from "./engine";
import type { ConnectionRequest } from "./credentials";
import type { AdapterSnapshot, StoredConnectionRecord } from "@/lib/product/types";
import { makeId, patchStore, readStore, writeStore } from "@/lib/platform/json-store";

const CONNECTIONS_FILE = "connections.json";
const SNAPSHOTS_FILE = "snapshots.json";

function loadRecords() {
  return readStore<StoredConnectionRecord[]>(CONNECTIONS_FILE, []);
}

function writeRecords(records: StoredConnectionRecord[]) {
  writeStore(CONNECTIONS_FILE, records);
}

function loadSnapshots() {
  return readStore<AdapterSnapshot[]>(SNAPSHOTS_FILE, []);
}

function writeSnapshots(records: AdapterSnapshot[]) {
  writeStore(SNAPSHOTS_FILE, records);
}

function sanitizeRecord(record: StoredConnectionRecord) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { secretRef: _secretRef, secret: _secret, ...rest } = record;
  return rest;
}

function toStoredRecord(request: ConnectionRequest): StoredConnectionRecord {
  const profile = findConnectorProfile(request.tool);
  if (!profile) {
    throw new Error(`Unsupported connector: ${request.tool}`);
  }

  const guidance = getConnectionGuidance(profile.name, profile.family);
  const visibleFields = getVisibleConnectionFields(guidance, request.authMethod);
  const requiredFields = visibleFields.filter((field) => field.required).map((field) => field.key);

  if (!validateConnectionRequest(request, requiredFields)) {
    throw new Error("Missing required connection fields for the selected auth method.");
  }

  const connectionId = makeId(profile.name.toLowerCase().replace(/\s+/g, "-"));
  const adapter = resolveAdapterRecord(profile.name, profile.family, `${profile.family}-${profile.name.toLowerCase().replace(/\s+/g, "-")}`);
  const now = new Date().toISOString();

  const baseRecord: StoredConnectionRecord = {
    connectionId,
    tool: profile.name,
    family: profile.family,
    adapterId: adapter.adapterId,
    label: request.label,
    authMethod: request.authMethod,
    scopes: request.scopes,
    principal: request.principal,
    secret: request.secret,
    target: request.target,
    details: request.details,
    docsUrl: guidance.docsUrl,
    createdAt: now,
    updatedAt: now,
    status: "connected",
    secretRef: `${connectionId}:secret`,
    notes: request.notes,
    metadataSyncStatus: "idle",
    adapterHealth: "unknown",
  };

  const test = adapter.testConnection(baseRecord);
  const pipeline = identifyPipelineFromConnection(baseRecord, [baseRecord]);
  const inspect = adapter.inspect(baseRecord);
  const snapshot = buildSnapshotFromInspect(baseRecord, inspect, test, pipeline);

  return {
    ...baseRecord,
    lastTestResult: test,
    metadataSyncStatus: "fresh",
    metadataSyncedAt: snapshot.metadataSyncedAt,
    adapterHealth: test.status,
    status: test.ok ? "connected" : "error",
  };
}

export function saveConnection(request: ConnectionRequest) {
  const record = toStoredRecord(request);
  const records = loadRecords().filter(
    (existing) =>
      !(
        existing.tool === record.tool &&
        existing.label === record.label &&
        existing.target === record.target
      )
  );
  records.push(record);
  writeRecords(records);
  void refreshConnectionSnapshot(record.connectionId);
  return sanitizeRecord(record);
}

export function listConnections() {
  return loadRecords().map(sanitizeRecord);
}

export function listConnectionRecords() {
  return loadRecords();
}

export function getConnection(connectionId: string) {
  const record = loadRecords().find((storedConnection) => storedConnection.connectionId === connectionId);
  return record ? sanitizeRecord(record) : null;
}

export function getConnectionRecord(connectionId: string) {
  return loadRecords().find((storedConnection) => storedConnection.connectionId === connectionId) ?? null;
}

export function getSecretRef(connectionId: string) {
  return loadRecords().find((storedConnection) => storedConnection.connectionId === connectionId)?.secretRef ?? null;
}

export function deleteConnection(connectionId: string) {
  const records = loadRecords();
  const nextRecords = records.filter((storedConnection) => storedConnection.connectionId !== connectionId);
  writeRecords(nextRecords);
  writeSnapshots(loadSnapshots().filter((snapshot) => snapshot.connectionId !== connectionId));
  return nextRecords.length !== records.length;
}

export function getConnectionSnapshot(connectionId: string) {
  return loadSnapshots().find((snapshot) => snapshot.connectionId === connectionId) ?? null;
}

export function listConnectionSnapshots() {
  return loadSnapshots();
}

// ─── Store-level accessors for state-sync ────────────────────────────────────

export function getConnectionStore(): StoredConnectionRecord[] {
  return loadRecords();
}

export function saveConnectionStore(records: StoredConnectionRecord[]) {
  writeRecords(records);
}

export function getSnapshotStore(): AdapterSnapshot[] {
  return loadSnapshots();
}

export function saveSnapshotStore(records: AdapterSnapshot[]) {
  writeSnapshots(records);
}

export function refreshConnectionSnapshot(connectionId: string) {
  const record = getConnectionRecord(connectionId);
  if (!record) {
    return null;
  }

  const adapter = resolveAdapterRecord(record.tool, record.family, record.adapterId);
  const test = adapter.testConnection(record);
  const pipeline = identifyPipelineFromConnection(record, loadRecords());
  const inspect = adapter.inspect(record);
  const snapshot = buildSnapshotFromInspect(record, inspect, test, pipeline);

  const updatedRecord: StoredConnectionRecord = {
    ...record,
    updatedAt: new Date().toISOString(),
    lastTestResult: test,
    metadataSyncStatus: "fresh",
    metadataSyncedAt: snapshot.metadataSyncedAt,
    adapterHealth: test.status,
    status: test.ok ? "connected" : "error",
  };

  patchStore(CONNECTIONS_FILE, loadRecords(), (records) =>
    records.map((item) => (item.connectionId === connectionId ? updatedRecord : item))
  );

  patchStore(SNAPSHOTS_FILE, loadSnapshots(), (snapshots) => {
    const next = snapshots.filter((item) => item.connectionId !== connectionId);
    next.push(snapshot);
    return next;
  });

  return snapshot;
}

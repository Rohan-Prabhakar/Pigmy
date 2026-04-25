/**
 * state-sync.ts
 *
 * Syncs non-assistant state (connections, quality, settings, audit, snapshots,
 * knowledge) between the file-based working buffer and MongoDB.
 *
 * Assistant threads/messages now write directly to MongoDB via assistant/store.ts
 * and no longer go through this sync layer.
 */

import { getConnectionStore, getSnapshotStore, saveConnectionStore, saveSnapshotStore } from "@/lib/connectors/vault";
import { getKnowledgeStore, saveKnowledgeStore } from "@/lib/knowledge/store";
import type {
  AdapterSnapshot,
  AuditEventRecord,
  QualityStore,
  SettingsState,
  StoredConnectionRecord,
} from "@/lib/product/types";
import type { KnowledgeStore } from "@/lib/knowledge/store";
import {
  getAuditLog,
  getQualityStore,
  getSettings,
  saveAuditLog,
  saveQualityStore,
  saveSettings,
} from "@/lib/quality/store";
import { readMongoState, writeMongoState } from "./mongo";

const KEYS = {
  quality:     "quality_store",
  settings:    "settings_state",
  audit:       "audit_log",
  connections: "connections_store",
  snapshots:   "snapshots_store",
  knowledge:   "knowledge_store",
} as const;

export async function hydrateCoreStateFromMongo(): Promise<void> {
  try {
    const [quality, settings, audit, connections, snapshots, knowledge] =
      await Promise.all([
        readMongoState<QualityStore>(KEYS.quality),
        readMongoState<SettingsState>(KEYS.settings),
        readMongoState<AuditEventRecord[]>(KEYS.audit),
        readMongoState<StoredConnectionRecord[]>(KEYS.connections),
        readMongoState<AdapterSnapshot[]>(KEYS.snapshots),
        readMongoState<KnowledgeStore>(KEYS.knowledge),
      ]);

    if (quality)     saveQualityStore(quality);
    if (settings)    saveSettings(settings);
    if (audit)       saveAuditLog(audit);
    if (connections) saveConnectionStore(connections);
    if (snapshots)   saveSnapshotStore(snapshots);
    if (knowledge)   saveKnowledgeStore(knowledge);
  } catch (error) {
    console.error("[state-sync] Failed to hydrate from MongoDB:", error);
  }
}

export async function persistCoreStateToMongo(): Promise<void> {
  try {
    await Promise.all([
      writeMongoState(KEYS.quality,     getQualityStore()),
      writeMongoState(KEYS.settings,    getSettings()),
      writeMongoState(KEYS.audit,       getAuditLog()),
      writeMongoState(KEYS.connections, getConnectionStore()),
      writeMongoState(KEYS.snapshots,   getSnapshotStore()),
      writeMongoState(KEYS.knowledge,   getKnowledgeStore()),
    ]);
  } catch (error) {
    console.error("[state-sync] Failed to persist to MongoDB:", error);
  }
}

import { makeId, patchStore, readStore, writeStore } from "@/lib/platform/json-store";
import type {
  AuditEventRecord,
  MailSettings,
  QualityAlert,
  QualityRule,
  QualityRun,
  QualitySeverity,
  QualityStore,
  SettingsState,
} from "@/lib/product/types";

const QUALITY_FILE = "quality.json";
const SETTINGS_FILE = "settings.json";
const AUDIT_FILE = "audit.json";

const defaultQuality: QualityStore = {
  rules: [],
  runs: [],
  alerts: [],
};

const defaultSettings: SettingsState = {
  modelRouting: {
    fastModel: "llama3.2:1b",
    deepModel: "pipeline-qwen-sft",
    redHerringModel: "pipeline-qwen-sft",
  },
  retrieval: {
    enabled: true,
    strategy: "hybrid",
    topK: 5,
  },
  auditRetentionDays: 30,
  approvals: {
    requireApprovalFor: [],
  },
  mail: {
    host: "",
    port: 587,
    username: "",
    sender: "",
    enabled: false,
    recipients: [],
  },
};

export function getQualityStore() {
  return readStore<QualityStore>(QUALITY_FILE, defaultQuality);
}

export function saveQualityStore(store: QualityStore) {
  writeStore(QUALITY_FILE, store);
}

export function getSettings() {
  return readStore<SettingsState>(SETTINGS_FILE, defaultSettings);
}

export function saveSettings(settings: SettingsState) {
  writeStore(SETTINGS_FILE, settings);
}

export function getAuditLog() {
  return readStore<AuditEventRecord[]>(AUDIT_FILE, []);
}

export function saveAuditLog(events: AuditEventRecord[]) {
  writeStore(AUDIT_FILE, events);
}

export function addAuditEvent(event: Omit<AuditEventRecord, "eventId" | "createdAt">) {
  return patchStore(AUDIT_FILE, [] as AuditEventRecord[], (events) => {
    const nextEvent: AuditEventRecord = {
      eventId: makeId("audit"),
      createdAt: new Date().toISOString(),
      ...event,
    };
    return [nextEvent, ...events].slice(0, 200);
  })[0];
}

export function upsertMailSettings(mail: Partial<MailSettings>) {
  const next = {
    ...getSettings(),
    mail: {
      ...getSettings().mail,
      ...mail,
    },
  };
  saveSettings(next);
  return next.mail;
}

export function addQualityRule(rule: Omit<QualityRule, "ruleId" | "createdAt" | "updatedAt">) {
  const nextRule: QualityRule = {
    ruleId: makeId("rule"),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...rule,
  };
  const store = getQualityStore();
  store.rules.unshift(nextRule);
  saveQualityStore(store);
  addAuditEvent({
    type: "rule_drafted",
    detail: `Drafted quality rule ${nextRule.title}`,
    metadata: { ruleId: nextRule.ruleId, severity: nextRule.severity },
  });
  return nextRule;
}

export function upsertQualityRule(rule: QualityRule) {
  const store = getQualityStore();
  const index = store.rules.findIndex((item) => item.ruleId === rule.ruleId);
  if (index >= 0) {
    store.rules[index] = rule;
  } else {
    store.rules.unshift(rule);
  }
  saveQualityStore(store);
  return rule;
}

export function updateQualityRule(
  ruleId: string,
  updates: Partial<Pick<QualityRule, "status" | "frequency" | "title" | "description" | "severity">>
) {
  const store = getQualityStore();
  const rule = store.rules.find((item) => item.ruleId === ruleId);
  if (!rule) return null;

  // Strip undefined so existing fields are never overwritten with undefined
  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, v]) => v !== undefined)
  );
  Object.assign(rule, cleanUpdates, { updatedAt: new Date().toISOString() });
  saveQualityStore(store);
  addAuditEvent({
    type: "rule_approved",
    detail: `Updated quality rule ${rule.title}`,
    metadata: { ruleId, updates },
  });
  return rule;
}

export function deleteQualityRule(ruleId: string) {
  const store = getQualityStore();
  const rule = store.rules.find((item) => item.ruleId === ruleId);
  if (!rule) return null;

  store.rules = store.rules.filter((item) => item.ruleId !== ruleId);
  store.runs = store.runs.filter((item) => item.ruleId !== ruleId);
  store.alerts = store.alerts.filter((item) => item.ruleId !== ruleId);
  saveQualityStore(store);
  addAuditEvent({
    type: "rule_approved",
    detail: `Deleted quality rule ${rule.title}`,
    metadata: { ruleId },
  });
  return rule;
}

export function approveQualityRule(ruleId: string) {
  const store = getQualityStore();
  const rule = store.rules.find((item) => item.ruleId === ruleId);
  if (!rule) return null;
  rule.status = "approved";
  rule.updatedAt = new Date().toISOString();
  const run: QualityRun = {
    runId: makeId("run"),
    ruleId,
    status: severityRank(rule.severity) >= severityRank("SEV-2") ? "fail" : "warn",
    severity: rule.severity,
    triggerSource: "assistant",
    adapterId: rule.tool.toLowerCase().replace(/\s+/g, "-"),
    evidence: rule.draft.evidence,
    citations: rule.citations,
    executedAt: new Date().toISOString(),
  };
  const alert: QualityAlert = {
    alertId: makeId("alert"),
    ruleId,
    title: rule.title,
    severity: rule.severity,
    status: "open",
    detail: `Generated from approved rule ${rule.title}.`,
    createdAt: new Date().toISOString(),
    mailDeliveredAt: getSettings().mail.enabled ? new Date().toISOString() : undefined,
  };
  store.runs.unshift(run);
  store.alerts.unshift(alert);
  saveQualityStore(store);
  addAuditEvent({
    type: "rule_approved",
    detail: `Approved quality rule ${rule.title}`,
    metadata: { ruleId },
  });
  if (alert.mailDeliveredAt) {
    addAuditEvent({
      type: "alert_sent",
      detail: `Prepared SMTP delivery for ${alert.title}`,
      metadata: { alertId: alert.alertId, severity: alert.severity },
    });
  }
  return rule;
}

export function addQualityRun(run: Omit<QualityRun, "runId" | "executedAt">) {
  const nextRun: QualityRun = {
    runId: makeId("run"),
    executedAt: new Date().toISOString(),
    ...run,
  };
  const store = getQualityStore();
  store.runs.unshift(nextRun);
  saveQualityStore(store);
  addAuditEvent({
    type: "quality_run",
    detail: `Executed quality rule ${run.ruleId} with status ${run.status}`,
    metadata: { ruleId: run.ruleId, severity: run.severity },
  });
  return nextRun;
}

export function upsertComputedRuns(runs: QualityRun[]) {
  if (!runs.length) return;
  const store = getQualityStore();
  const byId = new Map(store.runs.map((r) => [r.runId, r]));
  for (const run of runs) byId.set(run.runId, run);
  // Keep most recent 200 runs to prevent unbounded growth
  store.runs = [...byId.values()]
    .sort((a, b) => b.executedAt.localeCompare(a.executedAt))
    .slice(0, 200);
  saveQualityStore(store);
}

export function addQualityAlert(alert: Omit<QualityAlert, "alertId" | "createdAt">) {
  const nextAlert: QualityAlert = {
    alertId: makeId("alert"),
    createdAt: new Date().toISOString(),
    ...alert,
  };
  const store = getQualityStore();
  store.alerts.unshift(nextAlert);
  saveQualityStore(store);
  return nextAlert;
}

export function severityRank(severity: QualitySeverity) {
  return {
    "SEV-1": 4,
    "SEV-2": 3,
    "SEV-3": 2,
    "SEV-4": 1,
  }[severity];
}

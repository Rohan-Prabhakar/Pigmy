/**
 * http-executor.ts
 *
 * Real HTTP/REST execution for API-based connectors:
 * Databricks, Airflow, Fivetran, Looker, Airbyte, dbt Cloud,
 * Tableau, Power BI, Apache Superset, Confluent.
 */

import type { StoredConnectionRecord } from "@/lib/product/types";
import type { ConnectorAction } from "@/lib/connectors/types";

export type ExecutorResult = {
  summary: string;
  evidence: string[];
  rows?: Record<string, unknown>[];
  live: boolean;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function basicAuth(user: string, pass: string) {
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

async function apiFetch(
  url: string,
  options: RequestInit = {}
): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const res = await fetch(url, { ...options, signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    throw new Error(`Request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function formatRows(data: unknown, maxItems = 15): string[] {
  if (Array.isArray(data)) {
    return data.slice(0, maxItems).map((item) =>
      typeof item === "object" && item !== null
        ? Object.entries(item as Record<string, unknown>)
            .slice(0, 6)
            .map(([k, v]) => `${k}=${v ?? "null"}`)
            .join("  ")
        : String(item)
    );
  }
  if (typeof data === "object" && data !== null) {
    return Object.entries(data as Record<string, unknown>)
      .slice(0, maxItems)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
  }
  return [String(data)];
}

function missingCreds(...fields: Array<string | undefined>): string | null {
  const missing = fields.filter((f) => !f);
  return missing.length ? `Missing credentials (${missing.length} required field(s) not set).` : null;
}

// ---------------------------------------------------------------------------
// Databricks
// ---------------------------------------------------------------------------

async function executeDatabricks(
  connection: StoredConnectionRecord,
  action: ConnectorAction
): Promise<ExecutorResult> {
  const host = (connection.details?.host ?? connection.target ?? "").replace(/\/$/, "");
  const token = connection.secret ?? "";

  const err = missingCreds(host, token);
  if (err) return { summary: err, evidence: ["Set host in details and PAT as secret."], live: false };

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const endpoints: Record<string, string> = {
    query:          `${host}/api/2.1/jobs/list?limit=20`,
    fetch_logs:     `${host}/api/2.1/jobs/runs/list?limit=20`,
    validate:       `${host}/api/2.0/clusters/list`,
    fetch_metadata: `${host}/api/2.0/sql/warehouses`,
    inspect:        `${host}/api/2.0/workspace/list?path=/`,
    discover:       `${host}/api/2.1/jobs/list?limit=20`,
    test_connection:`${host}/api/2.0/clusters/list`,
  };

  const url = endpoints[action] ?? endpoints.inspect;
  const { ok, status, data } = await apiFetch(url, { headers });

  if (!ok) return {
    summary: `Databricks ${action} returned HTTP ${status}.`,
    evidence: [formatRows(data, 3).join(" | ")],
    live: false,
  };

  const items = (data as Record<string, unknown[]>)?.[Object.keys(data as object)[0]] ?? data;
  const rows = Array.isArray(items) ? items as Record<string, unknown>[] : [data as Record<string, unknown>];
  return {
    summary: `Databricks ${action}: ${rows.length} result(s) from ${host}.`,
    evidence: [`Workspace: ${host}`, `Endpoint: ${url}`, ...formatRows(rows)],
    rows,
    live: true,
  };
}

// ---------------------------------------------------------------------------
// Airflow
// ---------------------------------------------------------------------------

async function executeAirflow(
  connection: StoredConnectionRecord,
  action: ConnectorAction
): Promise<ExecutorResult> {
  const base = (connection.details?.base_url ?? connection.target ?? "").replace(/\/$/, "");
  const user = connection.principal ?? "";
  const pass = connection.secret ?? "";

  const err = missingCreds(base, user, pass);
  if (err) return { summary: err, evidence: ["Set base_url, principal (username), and secret (password)."], live: false };

  const headers = { Authorization: basicAuth(user, pass), "Content-Type": "application/json" };

  const endpoints: Record<string, { url: string; method?: string; body?: string }> = {
    query:          { url: `${base}/api/v1/dags?limit=20` },
    fetch_logs:     { url: `${base}/api/v1/dags/~/dagRuns?state=failed&limit=20` },
    validate:       { url: `${base}/api/v1/dags/~/dagRuns?state=failed&limit=10` },
    fetch_metadata: { url: `${base}/api/v1/connections` },
    inspect:        { url: `${base}/api/v1/dags?limit=10` },
    discover:       { url: `${base}/api/v1/dags?limit=20` },
    test_connection:{ url: `${base}/api/v1/health` },
  };

  const ep = endpoints[action] ?? endpoints.inspect;
  const { ok, status, data } = await apiFetch(ep.url, { method: ep.method ?? "GET", headers, body: ep.body });

  if (!ok) return {
    summary: `Airflow ${action} returned HTTP ${status}.`,
    evidence: [formatRows(data, 2).join(" | ")],
    live: false,
  };

  const items = (data as Record<string, unknown>)?.dags
    ?? (data as Record<string, unknown>)?.dag_runs
    ?? (data as Record<string, unknown>)?.connections
    ?? data;
  const rows = Array.isArray(items) ? items as Record<string, unknown>[] : [data as Record<string, unknown>];
  return {
    summary: `Airflow ${action}: ${rows.length} result(s) from ${base}.`,
    evidence: [`Host: ${base}`, ...formatRows(rows)],
    rows,
    live: true,
  };
}

// ---------------------------------------------------------------------------
// Fivetran
// ---------------------------------------------------------------------------

async function executeFivetran(
  connection: StoredConnectionRecord,
  action: ConnectorAction
): Promise<ExecutorResult> {
  const apiKey    = connection.details?.api_key ?? connection.principal ?? "";
  const apiSecret = connection.details?.api_secret ?? connection.secret ?? "";
  const groupId   = connection.details?.group_id ?? "";

  const err = missingCreds(apiKey, apiSecret);
  if (err) return { summary: err, evidence: ["Set api_key and api_secret in details."], live: false };

  const headers = { Authorization: basicAuth(apiKey, apiSecret), "Content-Type": "application/json" };
  const base = "https://api.fivetran.com";

  const endpoints: Record<string, string> = {
    query:          `${base}/v1/connectors?limit=20`,
    fetch_logs:     groupId ? `${base}/v1/groups/${groupId}/connectors?limit=20` : `${base}/v1/connectors?limit=20`,
    validate:       `${base}/v1/connectors?limit=20`,
    fetch_metadata: `${base}/v1/destinations${groupId ? `/${groupId}` : ""}`,
    inspect:        `${base}/v1/connectors?limit=10`,
    discover:       `${base}/v1/connectors?limit=20`,
    test_connection:`${base}/v1/connectors?limit=1`,
  };

  const url = endpoints[action] ?? endpoints.inspect;
  const { ok, status, data } = await apiFetch(url, { headers });

  if (!ok) return {
    summary: `Fivetran ${action} returned HTTP ${status}.`,
    evidence: [formatRows(data, 2).join(" | ")],
    live: false,
  };

  const items = (data as Record<string, unknown>)?.data ?? data;
  const rows = Array.isArray(items) ? items as Record<string, unknown>[] : [data as Record<string, unknown>];
  return {
    summary: `Fivetran ${action}: ${rows.length} connector(s).`,
    evidence: [`Group: ${groupId || "default"}`, ...formatRows(rows)],
    rows,
    live: true,
  };
}

// ---------------------------------------------------------------------------
// Looker
// ---------------------------------------------------------------------------

async function getLookerToken(base: string, clientId: string, clientSecret: string): Promise<string> {
  const { ok, data } = await apiFetch(`${base}/api/4.0/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}`,
  });
  if (!ok) throw new Error("Looker login failed");
  return (data as Record<string, string>).access_token;
}

async function executeLooker(
  connection: StoredConnectionRecord,
  action: ConnectorAction
): Promise<ExecutorResult> {
  const base       = (connection.details?.base_url ?? connection.target ?? "").replace(/\/$/, "");
  const clientId   = connection.details?.client_id ?? connection.principal ?? "";
  const clientSecret = connection.secret ?? "";

  const err = missingCreds(base, clientId, clientSecret);
  if (err) return { summary: err, evidence: ["Set base_url, client_id (details), and secret (client_secret)."], live: false };

  let token: string;
  try {
    token = await getLookerToken(base, clientId, clientSecret);
  } catch (e) {
    return { summary: `Looker auth failed: ${e instanceof Error ? e.message : e}`, evidence: [], live: false };
  }

  const headers = { Authorization: `Bearer ${token}` };

  const endpoints: Record<string, string> = {
    query:          `${base}/api/4.0/dashboards?limit=20`,
    fetch_logs:     `${base}/api/4.0/running_queries`,
    validate:       `${base}/api/4.0/content_validation`,
    fetch_metadata: `${base}/api/4.0/lookml_models`,
    inspect:        `${base}/api/4.0/dashboards?limit=10`,
    discover:       `${base}/api/4.0/dashboards?limit=20`,
    test_connection:`${base}/api/4.0/session`,
  };

  const url = endpoints[action] ?? endpoints.inspect;
  const { ok, status, data } = await apiFetch(url, { headers });

  if (!ok) return {
    summary: `Looker ${action} returned HTTP ${status}.`,
    evidence: [formatRows(data, 2).join(" | ")],
    live: false,
  };

  const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [data as Record<string, unknown>];
  return {
    summary: `Looker ${action}: ${rows.length} result(s) from ${base}.`,
    evidence: [`Host: ${base}`, ...formatRows(rows)],
    rows,
    live: true,
  };
}

// ---------------------------------------------------------------------------
// Airbyte
// ---------------------------------------------------------------------------

async function executeAirbyte(
  connection: StoredConnectionRecord,
  action: ConnectorAction
): Promise<ExecutorResult> {
  const base        = (connection.details?.base_url ?? connection.target ?? "").replace(/\/$/, "");
  const workspaceId = connection.details?.workspace_id ?? "";
  const user        = connection.principal ?? "";
  const pass        = connection.secret ?? "";

  if (!base) return { summary: "Missing Airbyte base URL.", evidence: ["Set base_url in details."], live: false };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (user && pass) headers["Authorization"] = basicAuth(user, pass);

  type Endpoint = { url: string; method: string; body?: string };
  const endpoints: Record<string, Endpoint> = {
    query:          { url: `${base}/api/v1/connections/list`,     method: "POST", body: JSON.stringify({ workspaceId }) },
    fetch_logs:     { url: `${base}/api/v1/jobs/list`,            method: "POST", body: JSON.stringify({ configTypes: ["sync"], workspaceId, includingJobStatus: "failed" }) },
    validate:       { url: `${base}/api/v1/connections/list`,     method: "POST", body: JSON.stringify({ workspaceId }) },
    fetch_metadata: { url: `${base}/api/v1/sources/list`,         method: "POST", body: JSON.stringify({ workspaceId }) },
    inspect:        { url: `${base}/api/v1/sources/list`,         method: "POST", body: JSON.stringify({ workspaceId }) },
    discover:       { url: `${base}/api/v1/destinations/list`,    method: "POST", body: JSON.stringify({ workspaceId }) },
    test_connection:{ url: `${base}/api/v1/health`,               method: "GET" },
  };

  const ep = endpoints[action] ?? endpoints.inspect;
  const { ok, status, data } = await apiFetch(ep.url, { method: ep.method, headers, body: ep.body });

  if (!ok) return {
    summary: `Airbyte ${action} returned HTTP ${status}.`,
    evidence: [formatRows(data, 2).join(" | ")],
    live: false,
  };

  const items = (data as Record<string, unknown>)?.connections
    ?? (data as Record<string, unknown>)?.jobs
    ?? (data as Record<string, unknown>)?.sources
    ?? (data as Record<string, unknown>)?.destinations
    ?? data;
  const rows = Array.isArray(items) ? items as Record<string, unknown>[] : [data as Record<string, unknown>];
  return {
    summary: `Airbyte ${action}: ${rows.length} result(s) from ${base}.`,
    evidence: [`Host: ${base}`, `Workspace: ${workspaceId || "n/a"}`, ...formatRows(rows)],
    rows,
    live: true,
  };
}

// ---------------------------------------------------------------------------
// dbt Cloud
// ---------------------------------------------------------------------------

async function executeDbt(
  connection: StoredConnectionRecord,
  action: ConnectorAction
): Promise<ExecutorResult> {
  const accountId = connection.details?.account_id ?? connection.target ?? "";
  const token     = connection.secret ?? "";

  const err = missingCreds(accountId, token);
  if (err) return { summary: err, evidence: ["Set account_id in details and service token as secret."], live: false };

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const base = "https://cloud.getdbt.com/api/v2";

  const endpoints: Record<string, string> = {
    query:          `${base}/accounts/${accountId}/jobs/?limit=20`,
    fetch_logs:     `${base}/accounts/${accountId}/runs/?status=error&limit=10`,
    validate:       `${base}/accounts/${accountId}/runs/?status=error&limit=10`,
    fetch_metadata: `${base}/accounts/${accountId}/jobs/?limit=20`,
    inspect:        `${base}/accounts/${accountId}/jobs/?limit=10`,
    discover:       `${base}/accounts/${accountId}/jobs/?limit=20`,
    test_connection:`${base}/accounts/${accountId}/`,
  };

  const url = endpoints[action] ?? endpoints.inspect;
  const { ok, status, data } = await apiFetch(url, { headers });

  if (!ok) return {
    summary: `dbt Cloud ${action} returned HTTP ${status}.`,
    evidence: [formatRows(data, 2).join(" | ")],
    live: false,
  };

  const items = (data as Record<string, unknown>)?.data ?? data;
  const rows = Array.isArray(items) ? items as Record<string, unknown>[] : [data as Record<string, unknown>];
  return {
    summary: `dbt Cloud ${action}: ${rows.length} result(s) for account ${accountId}.`,
    evidence: [`Account: ${accountId}`, ...formatRows(rows)],
    rows,
    live: true,
  };
}

// ---------------------------------------------------------------------------
// Tableau
// ---------------------------------------------------------------------------

async function getTableauToken(server: string, patName: string, patSecret: string, site: string): Promise<{ token: string; siteId: string }> {
  const { ok, data } = await apiFetch(`${server}/api/3.20/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credentials: { personalAccessTokenName: patName, personalAccessTokenSecret: patSecret, site: { contentUrl: site } } }),
  });
  if (!ok) throw new Error("Tableau signin failed");
  const d = data as Record<string, Record<string, Record<string, string> & { id?: string; token?: string }>>;
  return {
    token: String(d.credentials?.token ?? ""),
    siteId: String(d.credentials?.site?.id ?? ""),
  };
}

async function executeTableau(
  connection: StoredConnectionRecord,
  action: ConnectorAction
): Promise<ExecutorResult> {
  const server  = (connection.details?.server_url ?? connection.target ?? "").replace(/\/$/, "");
  const patName = connection.details?.pat_name ?? connection.principal ?? "";
  const patSecret = connection.secret ?? "";
  const site    = connection.details?.site_content_url ?? "";

  const err = missingCreds(server, patSecret);
  if (err) return { summary: err, evidence: ["Set server_url and secret (PAT secret)."], live: false };

  let token: string;
  let siteId: string;
  try {
    ({ token, siteId } = await getTableauToken(server, patName, patSecret, site));
  } catch (e) {
    return { summary: `Tableau auth failed: ${e instanceof Error ? e.message : e}`, evidence: [], live: false };
  }

  const headers = { "X-Tableau-Auth": token, "Content-Type": "application/json" };

  const endpoints: Record<string, string> = {
    query:          `${server}/api/3.20/sites/${siteId}/workbooks?pageSize=20`,
    fetch_logs:     `${server}/api/3.20/sites/${siteId}/jobs?pageSize=20`,
    validate:       `${server}/api/3.20/sites/${siteId}/tasks/extractRefreshes?pageSize=20`,
    fetch_metadata: `${server}/api/3.20/sites/${siteId}/datasources?pageSize=20`,
    inspect:        `${server}/api/3.20/sites/${siteId}/workbooks?pageSize=10`,
    discover:       `${server}/api/3.20/sites/${siteId}/workbooks?pageSize=20`,
    test_connection:`${server}/api/3.20/sites/${siteId}`,
  };

  const url = endpoints[action] ?? endpoints.inspect;
  const { ok, status, data } = await apiFetch(url, { headers });

  if (!ok) return {
    summary: `Tableau ${action} returned HTTP ${status}.`,
    evidence: [formatRows(data, 2).join(" | ")],
    live: false,
  };

  const container = data as Record<string, Record<string, unknown>>;
  const items = container.workbooks?.workbook
    ?? container.jobs?.job
    ?? container.tasks?.extractRefresh
    ?? container.datasources?.datasource
    ?? data;
  const rows = Array.isArray(items) ? items as Record<string, unknown>[] : [data as Record<string, unknown>];
  return {
    summary: `Tableau ${action}: ${rows.length} result(s) from ${server}.`,
    evidence: [`Server: ${server}`, `Site: ${siteId}`, ...formatRows(rows)],
    rows,
    live: true,
  };
}

// ---------------------------------------------------------------------------
// Power BI
// ---------------------------------------------------------------------------

async function getPowerBIToken(tenantId: string, clientId: string, clientSecret: string): Promise<string> {
  const { ok, data } = await apiFetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&scope=${encodeURIComponent("https://analysis.windows.net/powerbi/api/.default")}`,
    }
  );
  if (!ok) throw new Error("Power BI OAuth failed");
  return (data as Record<string, string>).access_token;
}

async function executePowerBI(
  connection: StoredConnectionRecord,
  action: ConnectorAction
): Promise<ExecutorResult> {
  const tenantId     = connection.details?.tenant_id ?? "";
  const clientId     = connection.details?.client_id ?? connection.principal ?? "";
  const clientSecret = connection.secret ?? "";
  const groupId      = connection.details?.group_id ?? "";

  const err = missingCreds(tenantId, clientId, clientSecret);
  if (err) return { summary: err, evidence: ["Set tenant_id, client_id, and secret (client_secret)."], live: false };

  let token: string;
  try {
    token = await getPowerBIToken(tenantId, clientId, clientSecret);
  } catch (e) {
    return { summary: `Power BI auth failed: ${e instanceof Error ? e.message : e}`, evidence: [], live: false };
  }

  const headers = { Authorization: `Bearer ${token}` };
  const scope = groupId ? `/groups/${groupId}` : "";

  const endpoints: Record<string, string> = {
    query:          `https://api.powerbi.com/v1.0/myorg${scope}/datasets`,
    fetch_logs:     `https://api.powerbi.com/v1.0/myorg${scope}/datasets`,
    validate:       `https://api.powerbi.com/v1.0/myorg${scope}/datasets`,
    fetch_metadata: `https://api.powerbi.com/v1.0/myorg${scope}/reports`,
    inspect:        `https://api.powerbi.com/v1.0/myorg${scope}/dashboards`,
    discover:       `https://api.powerbi.com/v1.0/myorg${scope}/datasets`,
    test_connection:`https://api.powerbi.com/v1.0/myorg`,
  };

  const url = endpoints[action] ?? endpoints.inspect;
  const { ok, status, data } = await apiFetch(url, { headers });

  if (!ok) return {
    summary: `Power BI ${action} returned HTTP ${status}.`,
    evidence: [formatRows(data, 2).join(" | ")],
    live: false,
  };

  const items = (data as Record<string, unknown>)?.value ?? data;
  const rows = Array.isArray(items) ? items as Record<string, unknown>[] : [data as Record<string, unknown>];
  return {
    summary: `Power BI ${action}: ${rows.length} result(s).`,
    evidence: [`Tenant: ${tenantId}`, `Group: ${groupId || "default"}`, ...formatRows(rows)],
    rows,
    live: true,
  };
}

// ---------------------------------------------------------------------------
// Apache Superset
// ---------------------------------------------------------------------------

async function getSupersetToken(base: string, username: string, password: string): Promise<string> {
  const { ok, data } = await apiFetch(`${base}/api/v1/security/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, provider: "db", refresh: true }),
  });
  if (!ok) throw new Error("Superset login failed");
  return (data as Record<string, string>).access_token;
}

async function executeSuperset(
  connection: StoredConnectionRecord,
  action: ConnectorAction
): Promise<ExecutorResult> {
  const base = (connection.details?.base_url ?? connection.target ?? "").replace(/\/$/, "");
  const user = connection.principal ?? "";
  const pass = connection.secret ?? "";

  const err = missingCreds(base, user, pass);
  if (err) return { summary: err, evidence: ["Set base_url, principal (username), and secret (password)."], live: false };

  let token: string;
  try {
    token = await getSupersetToken(base, user, pass);
  } catch (e) {
    return { summary: `Superset auth failed: ${e instanceof Error ? e.message : e}`, evidence: [], live: false };
  }

  const headers = { Authorization: `Bearer ${token}` };

  const endpoints: Record<string, string> = {
    query:          `${base}/api/v1/dashboard/?page_size=20`,
    fetch_logs:     `${base}/api/v1/log/?page_size=20`,
    validate:       `${base}/api/v1/chart/?page_size=20`,
    fetch_metadata: `${base}/api/v1/dataset/?page_size=20`,
    inspect:        `${base}/api/v1/dashboard/?page_size=10`,
    discover:       `${base}/api/v1/database/?page_size=20`,
    test_connection:`${base}/api/v1/dashboard/?page_size=1`,
  };

  const url = endpoints[action] ?? endpoints.inspect;
  const { ok, status, data } = await apiFetch(url, { headers });

  if (!ok) return {
    summary: `Superset ${action} returned HTTP ${status}.`,
    evidence: [formatRows(data, 2).join(" | ")],
    live: false,
  };

  const items = (data as Record<string, unknown>)?.result ?? data;
  const rows = Array.isArray(items) ? items as Record<string, unknown>[] : [data as Record<string, unknown>];
  return {
    summary: `Superset ${action}: ${rows.length} result(s) from ${base}.`,
    evidence: [`Host: ${base}`, ...formatRows(rows)],
    rows,
    live: true,
  };
}

// ---------------------------------------------------------------------------
// Confluent Cloud (REST Proxy / Admin API)
// ---------------------------------------------------------------------------

async function executeConfluent(
  connection: StoredConnectionRecord,
  action: ConnectorAction
): Promise<ExecutorResult> {
  const base    = (connection.details?.base_url ?? connection.target ?? "").replace(/\/$/, "");
  const apiKey  = connection.principal ?? "";
  const apiSec  = connection.secret ?? "";

  const err = missingCreds(base, apiKey, apiSec);
  if (err) return { summary: err, evidence: ["Set base_url, principal (API key), and secret (API secret)."], live: false };

  const headers = { Authorization: basicAuth(apiKey, apiSec), "Content-Type": "application/json" };

  const endpoints: Record<string, string> = {
    query:          `${base}/kafka/v3/clusters`,
    fetch_logs:     `${base}/kafka/v3/clusters`,
    validate:       `${base}/kafka/v3/clusters`,
    fetch_metadata: `${base}/kafka/v3/clusters`,
    inspect:        `${base}/kafka/v3/clusters`,
    discover:       `${base}/kafka/v3/clusters`,
    test_connection:`${base}/kafka/v3/clusters`,
  };

  const url = endpoints[action] ?? endpoints.inspect;
  const { ok, status, data } = await apiFetch(url, { headers });

  if (!ok) return {
    summary: `Confluent ${action} returned HTTP ${status}.`,
    evidence: [formatRows(data, 2).join(" | ")],
    live: false,
  };

  // After getting cluster list, fetch topics for the first cluster
  const clusters = (data as Record<string, unknown[]>)?.data ?? [];
  const clusterId = Array.isArray(clusters) && clusters.length > 0
    ? (clusters[0] as Record<string, string>).cluster_id
    : null;

  if (clusterId && (action === "query" || action === "inspect" || action === "discover")) {
    const topicRes = await apiFetch(`${base}/kafka/v3/clusters/${clusterId}/topics`, { headers });
    if (topicRes.ok) {
      const topics = (topicRes.data as Record<string, unknown[]>)?.data ?? [];
      const rows = Array.isArray(topics) ? topics as Record<string, unknown>[] : [];
      return {
        summary: `Confluent: ${rows.length} topic(s) on cluster ${clusterId}.`,
        evidence: [`Cluster: ${clusterId}`, ...formatRows(rows)],
        rows,
        live: true,
      };
    }
  }

  const rows = Array.isArray(clusters) ? clusters as Record<string, unknown>[] : [data as Record<string, unknown>];
  return {
    summary: `Confluent ${action}: ${rows.length} cluster(s).`,
    evidence: [`Base: ${base}`, ...formatRows(rows)],
    rows,
    live: true,
  };
}

// ---------------------------------------------------------------------------
// Public dispatch
// ---------------------------------------------------------------------------

const HTTP_EXECUTORS: Record<string, (c: StoredConnectionRecord, a: ConnectorAction) => Promise<ExecutorResult>> = {
  "databricks":       executeDatabricks,
  "apache airflow":   executeAirflow,
  "fivetran":         executeFivetran,
  "looker":           executeLooker,
  "airbyte":          executeAirbyte,
  "dbt":              executeDbt,
  "tableau":          executeTableau,
  "power bi":         executePowerBI,
  "apache superset":  executeSuperset,
  "confluent":        executeConfluent,
};

export function canHandleHttp(tool: string): boolean {
  return tool.toLowerCase() in HTTP_EXECUTORS;
}

export async function executeHttpConnector(
  connection: StoredConnectionRecord,
  action: ConnectorAction,
  generatedQuery?: string
): Promise<ExecutorResult> {
  const executor = HTTP_EXECUTORS[connection.tool.toLowerCase()];
  if (!executor) {
    return {
      summary: `No HTTP executor registered for ${connection.tool}.`,
      evidence: [],
      live: false,
    };
  }
  // For HTTP connectors the generatedQuery is an API path override — pass via action if present
  if (generatedQuery) {
    return executor({ ...connection, details: { ...(connection.details ?? {}), _overrideEndpoint: generatedQuery } }, action);
  }
  return executor(connection, action);
}

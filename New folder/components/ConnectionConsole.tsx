"use client";

import { useEffect, useMemo, useState } from "react";
import { BrandMark } from "@/components/BrandMark";
import { CONNECTOR_CATALOG, groupConnectorsByFamily } from "@/lib/connectors/catalog";
import {
  getConnectionGuidance,
  getVisibleConnectionFields,
  type ConnectionField,
} from "@/lib/connectors/connection-guidance";
import { getBrandLogo } from "@/lib/connectors/brand-logos";
import type {
  AuthMethod,
  StoredConnection,
} from "@/lib/connectors/credentials";
import type { ConnectorFamily, ConnectorProfile } from "@/lib/connectors/types";

const familyLabels: Record<ConnectorFamily, string> = {
  ingestion: "Ingestion / EL",
  orchestration: "Orchestration",
  compute: "Compute / Transform",
  warehouse: "Warehouse / Database",
  table_format: "Table Formats / File Formats",
  storage: "Storage",
  streaming: "Streaming",
  quality: "Data Quality",
  bi: "BI / Visualization",
  monitoring: "Monitoring / Observability",
  infrastructure: "Infrastructure",
};

const authMethodLabels: Record<AuthMethod, string> = {
  api_key: "API key",
  oauth: "OAuth",
  service_account: "Service account",
  basic: "Username/password",
  token: "Bearer token",
  personal_access_token: "Personal access token",
  key_pair: "Key pair",
  jwt: "JWT",
  kubeconfig: "Kubeconfig",
  cli_profile: "CLI profile",
  sasl: "SASL",
  jdbc: "JDBC / ODBC",
  unknown: "Custom",
};

const principalPriority = [
  "username",
  "principal",
  "client_id",
  "api_key",
  "pat_name",
  "profile_name",
];

const targetPriority = [
  "account",
  "base_url",
  "host",
  "server_url",
  "grafana_url",
  "prometheus_url",
  "project_id",
  "bootstrap_servers",
  "api_server",
  "context",
];

const secretPriority = [
  "password",
  "secret",
  "api_secret",
  "oauth_token",
  "private_key",
  "service_account_json",
  "pat",
  "pat_secret",
  "jwt_token",
  "bearer_token",
  "service_account_token",
  "access_token",
  "client_secret",
  "kubeconfig",
];

function getInitialFieldValues(
  profile: ConnectorProfile,
  connection?: StoredConnection
) {
  const guidance = getConnectionGuidance(profile.name, profile.family);
  const values: Record<string, string> = {};

  for (const field of guidance.fields) {
    values[field.key] = connection?.details?.[field.key] ?? "";
  }

  return values;
}

function inferPrincipal(details: Record<string, string>) {
  for (const key of principalPriority) {
    if (details[key]?.trim()) {
      return details[key].trim();
    }
  }
  return "";
}

function inferTarget(details: Record<string, string>) {
  for (const key of targetPriority) {
    if (details[key]?.trim()) {
      return details[key].trim();
    }
  }
  return "";
}

function inferSecret(details: Record<string, string>) {
  for (const key of secretPriority) {
    if (details[key]?.trim()) {
      return details[key].trim();
    }
  }
  return "";
}

function renderField(
  field: ConnectionField,
  value: string,
  setValue: (next: string) => void
) {
  const baseClass =
    "mt-2 w-full rounded-[16px] border border-[rgba(93,105,160,0.16)] bg-white px-3 py-2 text-sm text-black outline-none placeholder:text-neutral-400";

  if (field.input === "textarea") {
    return (
      <textarea
        className={baseClass}
        rows={field.secret ? 5 : 4}
        placeholder={field.placeholder}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    );
  }

  if (field.input === "select") {
    return (
      <select
        className={baseClass}
        value={value}
        onChange={(event) => setValue(event.target.value)}
      >
        <option value="">Select</option>
        {field.options?.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      className={baseClass}
      type={field.input === "password" ? "password" : "text"}
      placeholder={field.placeholder}
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

export function ConnectionConsole({ onDisconnect, onConnect }: { onDisconnect?: () => void; onConnect?: () => void } = {}) {
  const grouped = useMemo(() => groupConnectorsByFamily(), []);
  const [tool, setTool] = useState("Snowflake");
  const [label, setLabel] = useState("Primary connection");
  const [authMethod, setAuthMethod] = useState<AuthMethod>("basic");
  const [notes, setNotes] = useState("");
  const [details, setDetails] = useState<Record<string, string>>({});
  const [connections, setConnections] = useState<StoredConnection[]>([]);
  const [search, setSearch] = useState("");
  const [familyFilter, setFamilyFilter] = useState<ConnectorFamily | "all">("all");
  const [discoveredAuthRequiredTools, setDiscoveredAuthRequiredTools] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    summary: string;
    details: string[];
    status: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    void loadConnections();
  }, []);

  async function loadConnections() {
    const response = await fetch("/api/connections");
    const data = await response.json();
    setConnections(data.connections ?? []);
    setDiscoveredAuthRequiredTools(data.discoveredAuthRequiredTools ?? []);
  }

  async function handleSaveConnection() {
    if (!selectedProfile || !docsGuidance) {
      return;
    }

    setLoading(true);
    try {
      const payloadDetails = Object.fromEntries(
        Object.entries(details).filter(([, value]) => value.trim())
      );
      const response = await fetch("/api/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool,
          label,
          target: inferTarget(payloadDetails),
          authMethod,
          principal: inferPrincipal(payloadDetails),
          secret: inferSecret(payloadDetails),
          details: payloadDetails,
          notes,
        }),
      });

      await loadConnections();
      onConnect?.();
      setSavedToast(true);
      setTimeout(() => {
        setSavedToast(false);
        setIsModalOpen(false);
      }, 1400);
    } finally {
      setLoading(false);
    }
  }

  function openConnector(profile: ConnectorProfile) {
    const existing = connections.find((item) => item.tool === profile.name);
    const guidance = getConnectionGuidance(profile.name, profile.family);
    setTool(profile.name);
    setLabel(existing?.label ?? `${profile.name} connection`);
    setAuthMethod(existing?.authMethod ?? guidance.authMethods[0] ?? "unknown");
    setDetails(getInitialFieldValues(profile, existing));
    setNotes("");
    setSavedToast(false);
    setTestResult(existing?.lastTestResult ?? null);
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setSavedToast(false);
  }

  const selectedProfile = CONNECTOR_CATALOG.find((profile) => profile.name === tool);
  const selectedToolConnection = connections.find((item) => item.tool === tool);
  const docsGuidance = selectedProfile
    ? getConnectionGuidance(selectedProfile.name, selectedProfile.family)
    : null;
  const visibleFields = docsGuidance
    ? getVisibleConnectionFields(docsGuidance, authMethod)
    : [];

  // Families hidden from the catalog — not part of the core pipeline stack
  const hiddenFamilies = new Set<ConnectorFamily>(["quality", "monitoring"]);

  const visibleFamilies = (
    Object.entries(grouped) as Array<[ConnectorFamily, ConnectorProfile[]]>
  ).filter(([family, profiles]) => {
    // Always hide quality/monitoring unless the user explicitly filters to them
    if (familyFilter === "all" && hiddenFamilies.has(family)) return false;
    if (familyFilter !== "all" && family !== familyFilter) return false;
    if (!search.trim()) return true;

    const query = search.trim().toLowerCase();
    return profiles.some((profile) => profile.name.toLowerCase().includes(query));
  });

  const requiredFieldMissing = visibleFields.some((field) => {
    if (!field.required) return false;
    return !details[field.key]?.trim();
  });

  async function handleDisconnect() {
    if (!selectedToolConnection?.connectionId) return;
    const isAnchor = connections[0]?.connectionId === selectedToolConnection.connectionId;

    // Clear local state immediately so auth-required badges vanish before the API round-trip
    setConnections([]);
    setDiscoveredAuthRequiredTools([]);

    if (isAnchor) {
      // Sequential deletes — parallel requests each call hydrateCoreStateFromMongo and
      // can clobber each other, leaving stale connections in MongoDB.
      for (const c of connections) {
        await fetch(`/api/connections?connectionId=${encodeURIComponent(c.connectionId)}`, { method: "DELETE" });
      }
    } else {
      await fetch(`/api/connections?connectionId=${encodeURIComponent(selectedToolConnection.connectionId)}`, {
        method: "DELETE",
      });
    }
    await loadConnections();
    onDisconnect?.();
  }

  async function handleTestConnection() {
    if (!selectedToolConnection?.connectionId) return;
    setTesting(true);
    try {
      const response = await fetch("/api/connections/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId: selectedToolConnection.connectionId }),
      });
      const data = await response.json();
      setTestResult(data.result ?? null);
      await loadConnections();
    } finally {
      setTesting(false);
    }
  }

  return (
    <>
      <div>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs tracking-[0.18em] text-[#707a99]">
              Integrations
            </p>
            <h2 className="mt-2 text-4xl font-semibold tracking-[-0.04em] text-neutral-950">
              Connect your stack
            </h2>
          </div>

          <div className="flex flex-wrap gap-2">
            <input
              className="rounded-[16px] border border-[rgba(93,105,160,0.16)] bg-white px-3 py-2 text-sm text-black outline-none placeholder:text-neutral-400"
              placeholder="Search connectors"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              className="rounded-[16px] border border-[rgba(93,105,160,0.16)] bg-white px-3 py-2 text-sm text-black outline-none"
              value={familyFilter}
              onChange={(event) =>
                setFamilyFilter(event.target.value as ConnectorFamily | "all")
              }
            >
              <option value="all">All types</option>
              {Object.entries(familyLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-8 space-y-10">
          {visibleFamilies.map(([family, profiles]) => (
            <div key={family}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold tracking-[0.16em] text-neutral-700">
                  {familyLabels[family]}
                </h3>
                <p className="text-xs text-neutral-500">{profiles.length} tools</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {profiles.map((profile) => {
                  const logo = getBrandLogo(profile.name);
                  const isConnected = connections.some(
                    (item) => item.tool === profile.name
                  );
                  const isAnchor = connections[0]?.tool === profile.name;
                  const requiresAuth = !isConnected && discoveredAuthRequiredTools.includes(profile.name);
                  const isSelected = isModalOpen && tool === profile.name;

                  return (
                    <button
                      key={profile.name}
                      type="button"
                      onClick={() => openConnector(profile)}
                      className={`translate-x-0 translate-y-0 rounded-[22px] border border-[rgba(93,105,160,0.16)] p-4 text-left transition hover:border-[rgba(108,114,255,0.28)] hover:bg-[rgba(248,249,255,0.96)] ${
                        isSelected
                          ? "bg-[rgba(233,239,255,0.98)] text-black"
                          : "bg-[rgba(255,255,255,0.82)] text-black"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-11 w-11 items-center justify-center rounded-[14px] border border-[rgba(93,105,160,0.16)] bg-[rgba(243,245,255,0.92)] p-2">
                            <BrandMark
                              name={profile.name}
                              slug={logo.slug}
                              fallback={logo.fallback}
                            />
                          </div>
                          <div>
                            <p className="text-sm font-semibold flex items-center gap-1.5">
                              {profile.name}
                              {isAnchor && (
                                <span title="Anchor" className="text-indigo-400">
                                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
                                    <path d="M8 1a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm0 1.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2ZM8 7.25A.75.75 0 0 1 8.75 8v.316A5.25 5.25 0 0 1 13.2 12.5H14a.75.75 0 0 1 0 1.5h-.8a5.25 5.25 0 0 1-4.45 1.965V14.75a.75.75 0 0 1-1.5 0v-1.785A5.25 5.25 0 0 1 2.8 14H2a.75.75 0 0 1 0-1.5h.8a5.25 5.25 0 0 1 4.45-4.184V8A.75.75 0 0 1 8 7.25Zm0 2.5a3.75 3.75 0 1 0 0 7.5 3.75 3.75 0 0 0 0-7.5Z" />
                                  </svg>
                                </span>
                              )}
                            </p>
                            <p className="mt-1 text-xs text-neutral-600">
                              {profile.family.replace("_", " ")}
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1.5">
                          {isConnected ? (
                            <span className="rounded-full border border-[rgba(122,179,74,0.22)] bg-[#eef8df] px-2 py-1 text-[10px] font-semibold tracking-[0.12em] text-[#40621c]">
                              Connected
                            </span>
                          ) : null}
                          {requiresAuth ? (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-semibold tracking-[0.12em] text-amber-700">
                              Auth required
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {isModalOpen && selectedProfile && docsGuidance ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4 backdrop-blur-[2px]">
          <div className="grid max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-[30px] border border-[rgba(93,105,160,0.16)] bg-[rgba(250,249,255,0.96)] backdrop-blur-xl lg:grid-cols-[280px_minmax(0,1fr)]">
            <div className="border-b border-[rgba(93,105,160,0.12)] bg-[rgba(239,242,255,0.9)] p-5 lg:border-b-0 lg:border-r">
              <div className="flex items-start gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-[16px] border border-[rgba(93,105,160,0.16)] bg-white p-2">
                    <BrandMark
                      name={selectedProfile.name}
                      slug={getBrandLogo(selectedProfile.name).slug}
                      fallback={getBrandLogo(selectedProfile.name).fallback}
                    />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-black">
                      {selectedProfile.name}
                    </p>
                    <p className="text-xs tracking-[0.12em] text-black/60">
                      {selectedProfile.family.replace("_", " ")}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-6 space-y-5 text-sm text-black">
                <div>
                  <p className="text-xs font-semibold tracking-[0.12em] text-black/65">
                    Status
                  </p>
                  <p className="mt-2 text-sm">
                    {selectedToolConnection
                      ? "Connected"
                      : discoveredAuthRequiredTools.includes(selectedProfile.name)
                        ? "Discovered, auth required"
                        : "Not connected"}
                  </p>
                  {selectedToolConnection?.lastTestResult ? (
                    <p className="mt-2 text-xs text-neutral-600">
                      Last test: {selectedToolConnection.lastTestResult.summary}
                    </p>
                  ) : null}
                  {selectedToolConnection && (
                    <button
                      type="button"
                      onClick={() => void handleDisconnect()}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-100"
                    >
                      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="currentColor">
                        <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                      </svg>
                      Disconnect
                    </button>
                  )}
                </div>

                {docsGuidance.docsUrl ? (
                  <div>
                    <p className="text-xs font-semibold tracking-[0.12em] text-black/65">
                      Documentation
                    </p>
                    <a
                      href={docsGuidance.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-3 inline-flex rounded-full border border-[rgba(93,105,160,0.16)] bg-white px-3 py-2 text-xs font-medium tracking-[0.08em] text-black"
                    >
                      {docsGuidance.docsLabel ?? "Open documentation"}
                    </a>
                  </div>
                ) : null}

                <div>
                  <p className="text-xs font-semibold tracking-[0.12em] text-black/65">
                    Adapter capabilities
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {docsGuidance.availableActions.map((action) => (
                      <span
                        key={action}
                        className="rounded-full border border-[rgba(93,105,160,0.16)] bg-white px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-neutral-600"
                      >
                        {action.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="relative overflow-y-auto bg-[rgba(252,252,255,0.92)] p-5 pr-20 text-black">
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close modal"
                className="absolute right-5 top-5 flex h-9 w-9 items-center justify-center rounded-full border border-[rgba(93,105,160,0.16)] bg-white text-lg leading-none text-black"
              >
                <span className="material-symbols-rounded text-[20px] leading-none">close</span>
              </button>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold tracking-[0.12em] text-black/65">
                    Connection label
                  </span>
                  <input
                    className="mt-2 w-full rounded-[16px] border border-[rgba(93,105,160,0.16)] bg-white px-3 py-2 text-sm text-black outline-none placeholder:text-neutral-400"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="Primary warehouse"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-semibold tracking-[0.12em] text-black/65">
                    Auth method
                  </span>
                  <select
                    className="mt-2 w-full rounded-[16px] border border-[rgba(93,105,160,0.16)] bg-white px-3 py-2 text-sm text-black outline-none"
                    value={authMethod}
                    onChange={(event) =>
                      setAuthMethod(event.target.value as AuthMethod)
                    }
                  >
                    {docsGuidance.authMethods.map((item) => (
                      <option key={item} value={item}>
                        {authMethodLabels[item]}
                      </option>
                    ))}
                  </select>
                </label>

                {visibleFields.map((field) => (
                  <label
                    key={field.key}
                    className={`block ${
                      field.input === "textarea" ? "md:col-span-2" : ""
                    }`}
                  >
                    <span className="text-xs font-semibold tracking-[0.12em] text-black/65">
                      {field.label}
                    </span>
                    {renderField(field, details[field.key] ?? "", (next) =>
                      setDetails((current) => ({ ...current, [field.key]: next }))
                    )}
                    {field.description ? (
                      <span className="mt-2 block text-xs text-neutral-700">
                        {field.description}
                      </span>
                    ) : null}
                  </label>
                ))}

                <label className="block md:col-span-2">
                  <span className="text-xs font-semibold tracking-[0.12em] text-black/65">
                    Notes
                  </span>
                  <textarea
                    className="mt-2 w-full rounded-[16px] border border-[rgba(93,105,160,0.16)] bg-white px-3 py-2 text-sm text-black outline-none placeholder:text-neutral-400"
                    rows={4}
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Optional notes for this connection"
                  />
                </label>
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                {selectedToolConnection ? (
                  <button
                    className="rounded-full border border-[rgba(93,105,160,0.16)] bg-white px-4 py-2 text-sm font-medium text-neutral-700 disabled:cursor-not-allowed disabled:text-neutral-400"
                    onClick={handleTestConnection}
                    disabled={testing}
                    type="button"
                  >
                    {testing ? "Testing..." : "Test connection"}
                  </button>
                ) : null}
                <button
                  className="rounded-full border border-[rgba(108,114,255,0.28)] bg-[linear-gradient(180deg,#7d83ff,#6c72ff)] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:border-[rgba(93,105,160,0.12)] disabled:bg-neutral-200"
                  onClick={handleSaveConnection}
                  disabled={loading || requiredFieldMissing}
                  type="button"
                >
                  {loading ? "Saving..." : "Save connection"}
                </button>
              </div>

              {testResult ? (
                <div className="mt-4 rounded-[20px] border border-[rgba(93,105,160,0.16)] bg-[rgba(245,247,255,0.8)] p-4">
                  <p className="text-sm font-medium text-[#151828]">{testResult.summary}</p>
                  <div className="mt-2 space-y-1">
                    {testResult.details.map((detail) => (
                      <p key={detail} className="text-sm text-[#66708f]">
                        {detail}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}

              {savedToast && (
                <div className="mt-5 flex items-center gap-3 rounded-[18px] border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500">
                    <span className="material-symbols-rounded text-[16px] text-white">check</span>
                  </span>
                  <div>
                    <p className="text-sm font-semibold text-emerald-800">Connected</p>
                    <p className="text-xs text-emerald-700">{tool} saved successfully.</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

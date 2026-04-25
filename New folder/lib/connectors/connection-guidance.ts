import type { AuthMethod } from "./credentials";
import type { ConnectorAction, ConnectorFamily } from "./types";

export type ConnectionField = {
  key: string;
  label: string;
  input: "text" | "password" | "textarea" | "url" | "select";
  placeholder?: string;
  description?: string;
  required?: boolean;
  secret?: boolean;
  options?: string[];
  visibleForAuthMethods?: AuthMethod[];
};

export type ConnectionGuidance = {
  summary: string;
  methods: string[];
  authMethods: AuthMethod[];
  docsUrl?: string;
  docsLabel?: string;
  docsVerified: boolean;
  fields: ConnectionField[];
  availableActions: ConnectorAction[];
};

const warehouseActions: ConnectorAction[] = [
  "test_connection",
  "discover",
  "query",
  "validate",
  "fetch_metadata",
];

const orchestrationActions: ConnectorAction[] = [
  "test_connection",
  "discover",
  "inspect",
  "fetch_logs",
  "trigger",
  "restart",
];

const streamingActions: ConnectorAction[] = [
  "test_connection",
  "discover",
  "inspect",
  "fetch_logs",
  "restart",
];

const monitoringActions: ConnectorAction[] = [
  "test_connection",
  "discover",
  "inspect",
  "fetch_metadata",
];

const verifiedGuidance: Record<string, ConnectionGuidance> = {
  snowflake: {
    summary:
      "Snowflake supports password, browser SSO, key pair, and OAuth authentication. For operator workflows we should capture account information plus the warehouse, database, and role context the user wants the app to use.",
    methods: ["Username/password", "Browser SSO", "Key pair", "OAuth", "ODBC / JDBC"],
    authMethods: ["basic", "oauth", "key_pair", "jdbc"],
    docsUrl: "https://docs.snowflake.com/en/developer-guide/node-js/nodejs-driver-authenticate",
    docsLabel: "Snowflake authentication docs",
    docsVerified: true,
    availableActions: warehouseActions,
    fields: [
      {
        key: "account",
        label: "Account identifier",
        input: "text",
        placeholder: "xy12345.us-east-1",
        required: true,
      },
      {
        key: "username",
        label: "Username",
        input: "text",
        placeholder: "service_user",
        required: true,
        visibleForAuthMethods: ["basic", "key_pair"],
      },
      {
        key: "password",
        label: "Password",
        input: "password",
        placeholder: "Password",
        required: true,
        secret: true,
        visibleForAuthMethods: ["basic"],
      },
      {
        key: "private_key",
        label: "Private key",
        input: "textarea",
        placeholder: "-----BEGIN PRIVATE KEY-----",
        required: true,
        secret: true,
        visibleForAuthMethods: ["key_pair"],
      },
      {
        key: "oauth_token",
        label: "OAuth token",
        input: "password",
        placeholder: "OAuth access token",
        required: true,
        secret: true,
        visibleForAuthMethods: ["oauth"],
      },
      {
        key: "warehouse",
        label: "Warehouse",
        input: "text",
        placeholder: "COMPUTE_WH",
      },
      {
        key: "database",
        label: "Default database",
        input: "text",
        placeholder: "ANALYTICS",
      },
      {
        key: "role",
        label: "Role",
        input: "text",
        placeholder: "TRANSFORMER",
      },
    ],
  },
  "apache airflow": {
    summary:
      "Airflow's public API uses JWT authentication. The auth manager exposes a token endpoint, so the modal should capture the webserver URL and either credentials or a pre-issued JWT depending on how the deployment is configured.",
    methods: ["JWT token", "Username/password via auth manager"],
    authMethods: ["jwt", "basic"],
    docsUrl: "https://airflow.apache.org/docs/apache-airflow/stable/security/api.html",
    docsLabel: "Airflow public API auth",
    docsVerified: true,
    availableActions: orchestrationActions,
    fields: [
      {
        key: "base_url",
        label: "Webserver URL",
        input: "url",
        placeholder: "https://airflow.company.com",
        required: true,
      },
      {
        key: "username",
        label: "Username",
        input: "text",
        placeholder: "airflow-user",
        required: true,
        visibleForAuthMethods: ["basic"],
      },
      {
        key: "password",
        label: "Password",
        input: "password",
        placeholder: "Password",
        required: true,
        secret: true,
        visibleForAuthMethods: ["basic"],
      },
      {
        key: "jwt_token",
        label: "JWT token",
        input: "password",
        placeholder: "Bearer token",
        required: true,
        secret: true,
        visibleForAuthMethods: ["jwt"],
      },
    ],
  },
  fivetran: {
    summary:
      "Fivetran REST API authentication uses an API key and secret. Scoped API keys inherit the caller's RBAC permissions, so the modal only needs the key pair and the account context the user wants this connection associated with.",
    methods: ["Scoped API key", "System key"],
    authMethods: ["api_key"],
    docsUrl: "https://fivetran.com/docs/rest-api/getting-started",
    docsLabel: "Fivetran REST API auth",
    docsVerified: true,
    availableActions: ["test_connection", "discover", "inspect", "fetch_logs", "restart"],
    fields: [
      {
        key: "api_key",
        label: "API key",
        input: "text",
        placeholder: "fivetran_api_key",
        required: true,
      },
      {
        key: "api_secret",
        label: "API secret",
        input: "password",
        placeholder: "API secret",
        required: true,
        secret: true,
      },
      {
        key: "group_id",
        label: "Group ID",
        input: "text",
        placeholder: "Optional group scope",
      },
    ],
  },
  "google bigquery": {
    summary:
      "BigQuery programmatic access uses Google Cloud authentication. Application Default Credentials and service accounts are the normal choices, and BigQuery authorization still follows IAM on the underlying project and dataset resources.",
    methods: [
      "Application Default Credentials",
      "Service account",
      "User credentials",
    ],
    authMethods: ["service_account", "oauth"],
    docsUrl: "https://cloud.google.com/bigquery/docs/authentication",
    docsLabel: "BigQuery authentication",
    docsVerified: true,
    availableActions: warehouseActions,
    fields: [
      {
        key: "project_id",
        label: "Project ID",
        input: "text",
        placeholder: "my-gcp-project",
        required: true,
      },
      {
        key: "location",
        label: "Location",
        input: "text",
        placeholder: "US",
      },
      {
        key: "service_account_json",
        label: "Service account JSON",
        input: "textarea",
        placeholder: "{ ... }",
        required: true,
        secret: true,
        visibleForAuthMethods: ["service_account"],
      },
      {
        key: "oauth_token",
        label: "OAuth token",
        input: "password",
        placeholder: "OAuth access token",
        required: true,
        secret: true,
        visibleForAuthMethods: ["oauth"],
      },
    ],
  },
  databricks: {
    summary:
      "Databricks recommends OAuth for automation and still supports workspace PATs. The modal should capture the workspace host plus either a token or OAuth credentials so later actions can target the right workspace.",
    methods: ["OAuth", "Personal access token", "CLI profile"],
    authMethods: ["oauth", "personal_access_token", "cli_profile"],
    docsUrl: "https://docs.databricks.com/en/dev-tools/auth/pat.html",
    docsLabel: "Databricks auth",
    docsVerified: true,
    availableActions: ["test_connection", "discover", "inspect", "run", "restart"],
    fields: [
      {
        key: "host",
        label: "Workspace host",
        input: "url",
        placeholder: "https://dbc-123.cloud.databricks.com",
        required: true,
      },
      {
        key: "pat",
        label: "Personal access token",
        input: "password",
        placeholder: "dapi...",
        required: true,
        secret: true,
        visibleForAuthMethods: ["personal_access_token"],
      },
      {
        key: "client_id",
        label: "OAuth client ID",
        input: "text",
        placeholder: "client-id",
        required: true,
        visibleForAuthMethods: ["oauth"],
      },
      {
        key: "client_secret",
        label: "OAuth client secret",
        input: "password",
        placeholder: "client-secret",
        required: true,
        secret: true,
        visibleForAuthMethods: ["oauth"],
      },
      {
        key: "profile_name",
        label: "CLI profile name",
        input: "text",
        placeholder: "DEFAULT",
        required: true,
        visibleForAuthMethods: ["cli_profile"],
      },
    ],
  },
  "apache kafka": {
    summary:
      "Kafka authentication is usually broker-based and most deployments use SASL with either plaintext or SSL transport. The modal should capture brokers, protocol, mechanism, and credentials rather than a generic API key.",
    methods: ["SASL_SSL", "SASL_PLAINTEXT", "SCRAM / PLAIN via JAAS"],
    authMethods: ["sasl"],
    docsUrl: "https://kafka.apache.org/40/security/authentication-using-sasl/",
    docsLabel: "Kafka SASL docs",
    docsVerified: true,
    availableActions: streamingActions,
    fields: [
      {
        key: "bootstrap_servers",
        label: "Bootstrap servers",
        input: "text",
        placeholder: "broker1:9092,broker2:9092",
        required: true,
      },
      {
        key: "security_protocol",
        label: "Security protocol",
        input: "select",
        required: true,
        options: ["SASL_SSL", "SASL_PLAINTEXT"],
      },
      {
        key: "sasl_mechanism",
        label: "SASL mechanism",
        input: "select",
        required: true,
        options: ["SCRAM-SHA-256", "SCRAM-SHA-512", "PLAIN", "OAUTHBEARER", "GSSAPI"],
      },
      {
        key: "username",
        label: "Username",
        input: "text",
        placeholder: "kafka-client",
      },
      {
        key: "password",
        label: "Password",
        input: "password",
        placeholder: "Password",
        secret: true,
      },
    ],
  },
  tableau: {
    summary:
      "Tableau REST API sign-in supports personal access tokens, username and password, and connected-app JWT flows. The modal should capture the server URL and site scope in addition to whichever credential the user chooses.",
    methods: ["Personal access token", "Username/password", "JWT"],
    authMethods: ["personal_access_token", "basic", "jwt"],
    docsUrl:
      "https://help.tableau.com/current/api/rest_api/en-us/REST/rest_api_ref_authentication.htm",
    docsLabel: "Tableau REST auth",
    docsVerified: true,
    availableActions: ["test_connection", "discover", "inspect", "refresh"],
    fields: [
      {
        key: "server_url",
        label: "Server URL",
        input: "url",
        placeholder: "https://tableau.company.com",
        required: true,
      },
      {
        key: "site_content_url",
        label: "Site content URL",
        input: "text",
        placeholder: "marketing",
      },
      {
        key: "pat_name",
        label: "PAT name",
        input: "text",
        placeholder: "ops-bot",
        required: true,
        visibleForAuthMethods: ["personal_access_token"],
      },
      {
        key: "pat_secret",
        label: "PAT secret",
        input: "password",
        placeholder: "PAT secret",
        required: true,
        secret: true,
        visibleForAuthMethods: ["personal_access_token"],
      },
      {
        key: "username",
        label: "Username",
        input: "text",
        placeholder: "tableau-user",
        required: true,
        visibleForAuthMethods: ["basic"],
      },
      {
        key: "password",
        label: "Password",
        input: "password",
        placeholder: "Password",
        required: true,
        secret: true,
        visibleForAuthMethods: ["basic"],
      },
      {
        key: "jwt_token",
        label: "JWT token",
        input: "password",
        placeholder: "JWT token",
        required: true,
        secret: true,
        visibleForAuthMethods: ["jwt"],
      },
      {
        key: "log_path",
        label: "Optional log file path",
        input: "text",
        placeholder: "C:\\logs\\tableau-backgrounder.log",
      },
    ],
  },
  looker: {
    summary:
      "Looker uses API3 keys — a client_id and client_secret pair — to authenticate against its REST API. Generate an API3 key under Admin → Users → Edit user → API3 Keys. The base URL is your Looker instance host (e.g. https://yourcompany.looker.com). Port 19999 is used for self-hosted instances; Looker Cloud omits the port.",
    methods: ["API3 key (client_id + client_secret)"],
    authMethods: ["api_key"],
    docsUrl: "https://cloud.google.com/looker/docs/api-auth",
    docsLabel: "Looker API authentication",
    docsVerified: true,
    availableActions: ["test_connection", "discover", "inspect", "fetch_logs", "validate", "refresh"],
    fields: [
      {
        key: "base_url",
        label: "Looker instance URL",
        input: "url",
        placeholder: "https://yourcompany.looker.com",
        description: "Your Looker host. Self-hosted: include :19999. Looker Cloud: omit the port.",
        required: true,
      },
      {
        key: "client_id",
        label: "Client ID",
        input: "text",
        placeholder: "abc123xyz",
        description: "Found under Admin → Users → Edit user → API3 Keys.",
        required: true,
      },
      {
        key: "client_secret",
        label: "Client secret",
        input: "password",
        placeholder: "client_secret",
        description: "The secret paired with the Client ID above.",
        required: true,
        secret: true,
      },
    ],
  },
  "power bi": {
    summary:
      "Power BI API access for operational automation usually uses delegated OAuth or a service principal. The modal should capture workspace context plus the dataset/semantic model scope you want to inspect for refresh failures and stale dashboards.",
    methods: ["OAuth", "Service principal"],
    authMethods: ["oauth", "service_account"],
    docsUrl: "https://learn.microsoft.com/en-us/rest/api/power-bi/datasets/get-refresh-history",
    docsLabel: "Power BI refresh history",
    docsVerified: true,
    availableActions: ["test_connection", "discover", "inspect", "fetch_logs", "refresh"],
    fields: [
      {
        key: "tenant_id",
        label: "Tenant ID",
        input: "text",
        placeholder: "00000000-0000-0000-0000-000000000000",
        required: true,
      },
      {
        key: "group_id",
        label: "Workspace / group ID",
        input: "text",
        placeholder: "workspace-guid",
        required: true,
      },
      {
        key: "dataset_id",
        label: "Dataset / semantic model ID",
        input: "text",
        placeholder: "dataset-guid",
      },
      {
        key: "oauth_token",
        label: "OAuth access token",
        input: "password",
        placeholder: "Bearer token",
        required: true,
        secret: true,
        visibleForAuthMethods: ["oauth"],
      },
      {
        key: "client_id",
        label: "Client ID",
        input: "text",
        placeholder: "service-principal-client-id",
        required: true,
        visibleForAuthMethods: ["service_account"],
      },
      {
        key: "client_secret",
        label: "Client secret",
        input: "password",
        placeholder: "Client secret",
        required: true,
        secret: true,
        visibleForAuthMethods: ["service_account"],
      },
      {
        key: "log_path",
        label: "Optional log file path",
        input: "text",
        placeholder: "C:\\logs\\powerbi-refresh.log",
      },
    ],
  },
  "apache superset": {
    summary:
      "Superset exposes a JWT-secured REST API for dashboards, datasets, charts, and audit logs. The modal should capture the base URL plus either a JWT token or the username/password used to obtain one.",
    methods: ["JWT token", "Username/password"],
    authMethods: ["jwt", "basic"],
    docsUrl: "https://superset.apache.org/developer-docs/api/",
    docsLabel: "Superset REST API",
    docsVerified: true,
    availableActions: ["test_connection", "discover", "inspect", "fetch_logs", "refresh"],
    fields: [
      {
        key: "base_url",
        label: "Superset URL",
        input: "url",
        placeholder: "https://superset.company.com",
        required: true,
      },
      {
        key: "workspace",
        label: "Dashboard slug or workspace hint",
        input: "text",
        placeholder: "revenue-ops",
      },
      {
        key: "jwt_token",
        label: "JWT token",
        input: "password",
        placeholder: "access_token",
        required: true,
        secret: true,
        visibleForAuthMethods: ["jwt"],
      },
      {
        key: "username",
        label: "Username",
        input: "text",
        placeholder: "superset-user",
        required: true,
        visibleForAuthMethods: ["basic"],
      },
      {
        key: "password",
        label: "Password",
        input: "password",
        placeholder: "Password",
        required: true,
        secret: true,
        visibleForAuthMethods: ["basic"],
      },
      {
        key: "log_path",
        label: "Optional log file path",
        input: "text",
        placeholder: "C:\\logs\\superset.log",
      },
    ],
  },
  kubernetes: {
    summary:
      "Kubernetes API authentication commonly uses kubeconfig, client certificates, bearer tokens, or OIDC-backed JWTs depending on cluster setup. The modal should preserve the cluster context and whichever credential form the cluster expects.",
    methods: ["kubeconfig", "Client certificate", "Bearer token", "OIDC / JWT"],
    authMethods: ["kubeconfig", "token", "jwt"],
    docsUrl:
      "https://kubernetes.io/docs/reference/access-authn-authz/authentication/",
    docsLabel: "Kubernetes authentication",
    docsVerified: true,
    availableActions: ["test_connection", "discover", "inspect", "restart", "deploy"],
    fields: [
      {
        key: "api_server",
        label: "API server",
        input: "url",
        placeholder: "https://cluster.company.com",
      },
      {
        key: "kubeconfig",
        label: "Kubeconfig",
        input: "textarea",
        placeholder: "apiVersion: v1",
        required: true,
        secret: true,
        visibleForAuthMethods: ["kubeconfig"],
      },
      {
        key: "bearer_token",
        label: "Bearer token",
        input: "password",
        placeholder: "Bearer token",
        required: true,
        secret: true,
        visibleForAuthMethods: ["token", "jwt"],
      },
      {
        key: "context",
        label: "Context",
        input: "text",
        placeholder: "prod-cluster",
      },
      {
        key: "namespace",
        label: "Namespace",
        input: "text",
        placeholder: "default",
      },
    ],
  },
  grafana: {
    summary:
      "Grafana now recommends service accounts and service account tokens for automated API access. Tokens inherit the service account's permissions, so the modal should capture the Grafana URL plus a service account token.",
    methods: ["Service account token"],
    authMethods: ["token"],
    docsUrl:
      "https://grafana.com/docs/grafana/latest/administration/service-accounts/",
    docsLabel: "Grafana service accounts",
    docsVerified: true,
    availableActions: monitoringActions,
    fields: [
      {
        key: "grafana_url",
        label: "Grafana URL",
        input: "url",
        placeholder: "https://grafana.company.com",
        required: true,
      },
      {
        key: "service_account_token",
        label: "Service account token",
        input: "password",
        placeholder: "glsa_...",
        required: true,
        secret: true,
      },
    ],
  },
  prometheus: {
    summary:
      "Prometheus exposes a JSON HTTP API under /api/v1. The modal should capture the server URL and any access token or reverse-proxy credential your deployment requires.",
    methods: ["HTTP API", "Bearer token if proxied"],
    authMethods: ["token", "basic", "unknown"],
    docsUrl: "https://prometheus.io/docs/prometheus/3.4/querying/api/",
    docsLabel: "Prometheus HTTP API",
    docsVerified: true,
    availableActions: monitoringActions,
    fields: [
      {
        key: "prometheus_url",
        label: "Prometheus URL",
        input: "url",
        placeholder: "https://prometheus.company.com",
        required: true,
      },
      {
        key: "access_token",
        label: "Access token",
        input: "password",
        placeholder: "Optional bearer token",
        secret: true,
        visibleForAuthMethods: ["token"],
      },
      {
        key: "username",
        label: "Username",
        input: "text",
        placeholder: "Username",
        visibleForAuthMethods: ["basic"],
      },
      {
        key: "password",
        label: "Password",
        input: "password",
        placeholder: "Password",
        secret: true,
        visibleForAuthMethods: ["basic"],
      },
    ],
  },
};

const familyFallbacks: Record<ConnectorFamily, ConnectionGuidance> = {
  ingestion: {
    summary:
      "This connector usually relies on a vendor API or workspace host plus the credentials already allowed by the user's role. The exact setup guide for this tool is still being verified.",
    methods: ["API token or OAuth"],
    authMethods: ["api_key", "oauth", "basic", "token"],
    docsVerified: false,
    availableActions: ["test_connection", "discover", "inspect", "fetch_logs", "restart"],
    fields: [
      { key: "base_url", label: "Base URL", input: "url", placeholder: "https://...", required: true },
      { key: "username", label: "Username / principal", input: "text", placeholder: "service-user" },
      { key: "secret", label: "Credential", input: "password", placeholder: "token or password", secret: true, required: true },
    ],
  },
  orchestration: {
    summary:
      "This orchestration connector generally needs the scheduler or webserver URL plus the credential form your deployment already uses. Exact setup for this tool is still being verified.",
    methods: ["API token", "Basic auth", "OAuth"],
    authMethods: ["token", "basic", "oauth", "jwt"],
    docsVerified: false,
    availableActions: orchestrationActions,
    fields: [
      { key: "base_url", label: "Base URL", input: "url", placeholder: "https://...", required: true },
      { key: "username", label: "Username / principal", input: "text", placeholder: "operator" },
      { key: "secret", label: "Credential", input: "password", placeholder: "token or password", secret: true, required: true },
    ],
  },
  compute: {
    summary:
      "Compute and transform systems usually need a workspace host, project identifier, or API target plus a token or service credential. Exact setup for this tool is still being verified.",
    methods: ["Token", "OAuth", "Service account"],
    authMethods: ["token", "oauth", "service_account", "cli_profile"],
    docsVerified: false,
    availableActions: ["test_connection", "discover", "inspect", "run", "restart"],
    fields: [
      { key: "host", label: "Workspace host", input: "url", placeholder: "https://...", required: true },
      { key: "project", label: "Project / profile", input: "text", placeholder: "default" },
      { key: "secret", label: "Credential", input: "password", placeholder: "token or secret", secret: true, required: true },
    ],
  },
  warehouse: {
    summary:
      "Warehouse and database connectors usually require an account or host plus the exact credential form the user already has permission to use. Exact setup for this tool is still being verified.",
    methods: ["Username/password", "Token", "Service account", "ODBC / JDBC"],
    authMethods: ["basic", "token", "service_account", "jdbc", "oauth"],
    docsVerified: false,
    availableActions: warehouseActions,
    fields: [
      { key: "host", label: "Account / host", input: "text", placeholder: "account or hostname", required: true },
      { key: "database", label: "Database / catalog", input: "text", placeholder: "analytics" },
      { key: "username", label: "Username / principal", input: "text", placeholder: "service-user" },
      { key: "secret", label: "Credential", input: "password", placeholder: "password or token", secret: true, required: true },
    ],
  },
  table_format: {
    summary:
      "Table format connections are often metadata-driven and may not require direct credentials beyond the backing engine or storage system. Exact setup for this tool is still being verified.",
    methods: ["Backing engine credentials"],
    authMethods: ["unknown", "token", "basic"],
    docsVerified: false,
    availableActions: ["discover", "validate", "fetch_metadata"],
    fields: [
      { key: "catalog", label: "Catalog / metastore", input: "text", placeholder: "metastore" },
      { key: "target", label: "Target path or namespace", input: "text", placeholder: "s3://bucket/path" },
    ],
  },
  storage: {
    summary:
      "Storage systems typically need an endpoint or account name plus an access key, secret, or identity-based credential. Exact setup for this tool is still being verified.",
    methods: ["Access key", "Service account", "IAM / role-based auth"],
    authMethods: ["api_key", "service_account", "token", "basic"],
    docsVerified: false,
    availableActions: ["test_connection", "discover", "fetch_metadata"],
    fields: [
      { key: "endpoint", label: "Endpoint / account", input: "text", placeholder: "storage account or endpoint", required: true },
      { key: "access_key", label: "Access key / principal", input: "text", placeholder: "access key" },
      { key: "secret", label: "Secret", input: "password", placeholder: "secret", secret: true, required: true },
    ],
  },
  streaming: {
    summary:
      "Streaming systems usually need broker or endpoint addresses plus protocol-specific credentials. Exact setup for this tool is still being verified.",
    methods: ["SASL", "Token", "Basic auth"],
    authMethods: ["sasl", "token", "basic"],
    docsVerified: false,
    availableActions: streamingActions,
    fields: [
      { key: "endpoint", label: "Broker / endpoint", input: "text", placeholder: "host:port", required: true },
      { key: "username", label: "Username / principal", input: "text", placeholder: "client-id" },
      { key: "secret", label: "Secret", input: "password", placeholder: "token or password", secret: true, required: true },
    ],
  },
  quality: {
    summary:
      "Quality tools usually connect with an API token, cloud workspace, or CLI profile. Exact setup for this tool is still being verified.",
    methods: ["API token", "Service account", "CLI profile"],
    authMethods: ["token", "service_account", "cli_profile", "basic"],
    docsVerified: false,
    availableActions: ["test_connection", "discover", "inspect", "validate"],
    fields: [
      { key: "base_url", label: "Base URL", input: "url", placeholder: "https://...", required: true },
      { key: "secret", label: "Token / secret", input: "password", placeholder: "token", secret: true, required: true },
    ],
  },
  bi: {
    summary:
      "BI connectors usually need the server URL, workspace or site target, and a token or user credential. Exact setup for this tool is still being verified.",
    methods: ["PAT", "Basic auth", "OAuth"],
    authMethods: ["personal_access_token", "basic", "oauth", "token"],
    docsVerified: false,
    availableActions: ["test_connection", "discover", "inspect", "refresh"],
    fields: [
      { key: "base_url", label: "Base URL", input: "url", placeholder: "https://...", required: true },
      { key: "workspace", label: "Workspace / site", input: "text", placeholder: "default" },
      { key: "secret", label: "Credential", input: "password", placeholder: "token or password", secret: true, required: true },
    ],
  },
  monitoring: {
    summary:
      "Monitoring systems typically expose HTTP APIs and use service account tokens or proxy-authenticated access. Exact setup for this tool is still being verified.",
    methods: ["Service account token", "Bearer token", "Basic auth"],
    authMethods: ["token", "basic", "service_account"],
    docsVerified: false,
    availableActions: monitoringActions,
    fields: [
      { key: "base_url", label: "Base URL", input: "url", placeholder: "https://...", required: true },
      { key: "secret", label: "Credential", input: "password", placeholder: "token or password", secret: true, required: true },
    ],
  },
  infrastructure: {
    summary:
      "Infrastructure systems often rely on kubeconfig, CLI profiles, or API tokens tied to existing role bindings. Exact setup for this tool is still being verified.",
    methods: ["CLI profile", "Token", "kubeconfig"],
    authMethods: ["cli_profile", "token", "kubeconfig", "basic"],
    docsVerified: false,
    availableActions: ["test_connection", "discover", "inspect", "restart", "deploy"],
    fields: [
      { key: "target", label: "Target cluster / server", input: "text", placeholder: "cluster or host", required: true },
      { key: "secret", label: "Credential", input: "password", placeholder: "token or kubeconfig", secret: true, required: true },
    ],
  },
};

const toolFamilyMap: Record<string, ConnectorFamily> = {
  snowflake: "warehouse",
  "apache airflow": "orchestration",
  fivetran: "ingestion",
  "google bigquery": "warehouse",
  databricks: "compute",
  "apache kafka": "streaming",
  tableau: "bi",
  "power bi": "bi",
  "apache superset": "bi",
  kubernetes: "infrastructure",
  grafana: "bi",
  prometheus: "monitoring",
};

export function getConnectionGuidance(
  toolName: string,
  family?: ConnectorFamily
): ConnectionGuidance {
  const normalized = toolName.trim().toLowerCase();
  if (verifiedGuidance[normalized]) {
    return verifiedGuidance[normalized];
  }

  const resolvedFamily = family ?? toolFamilyMap[normalized] ?? "warehouse";
  return familyFallbacks[resolvedFamily];
}

export function getVisibleConnectionFields(
  guidance: ConnectionGuidance,
  authMethod: AuthMethod
) {
  return guidance.fields.filter((field) => {
    return !field.visibleForAuthMethods || field.visibleForAuthMethods.includes(authMethod);
  });
}

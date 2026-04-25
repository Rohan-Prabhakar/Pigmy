import type { ConnectorFamily } from "./types";
import type { AdapterHealth, ConnectionTestResult } from "@/lib/product/types";

export type AuthMethod =
  | "api_key"
  | "oauth"
  | "service_account"
  | "basic"
  | "token"
  | "personal_access_token"
  | "key_pair"
  | "jwt"
  | "kubeconfig"
  | "cli_profile"
  | "sasl"
  | "jdbc"
  | "unknown";

export type CredentialScope =
  | "read"
  | "discover"
  | "execute"
  | "admin"
  | "monitor"
  | "refresh";

export type CredentialBundle = {
  authMethod: AuthMethod;
  label: string;
  principal?: string;
  secret?: string;
  scopes?: CredentialScope[];
  notes?: string;
  expiresAt?: string;
};

export type StoredConnection = {
  connectionId: string;
  tool: string;
  family: ConnectorFamily;
  adapterId?: string;
  label: string;
  authMethod: AuthMethod;
  scopes?: CredentialScope[];
  principal?: string;
  target?: string;
  details?: Record<string, string>;
  docsUrl?: string;
  createdAt: string;
  updatedAt: string;
  status: "connected" | "disconnected" | "error";
  notes?: string;
  lastTestResult?: ConnectionTestResult;
  metadataSyncStatus?: "idle" | "fresh" | "stale" | "error";
  metadataSyncedAt?: string;
  adapterHealth?: AdapterHealth;
};

export type ConnectionRequest = {
  tool: string;
  label: string;
  target?: string;
  authMethod: AuthMethod;
  principal?: string;
  secret?: string;
  details?: Record<string, string>;
  scopes?: CredentialScope[];
  notes?: string;
};

export function parseScopes(input: string): CredentialScope[] {
  const allowed: CredentialScope[] = [
    "read",
    "discover",
    "execute",
    "admin",
    "monitor",
    "refresh",
  ];

  const parsed = input
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .filter((item): item is CredentialScope => allowed.includes(item as CredentialScope));

  return Array.from(new Set(parsed));
}

export function maskSecret(secret: string) {
  if (secret.length <= 4) {
    return "****";
  }

  return `${secret.slice(0, 2)}****${secret.slice(-2)}`;
}

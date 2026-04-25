import type { ConnectorAction } from "./types";

export const READ_ONLY_CONNECTOR_ACTIONS: ConnectorAction[] = [
  "discover",
  "inspect",
  "test_connection",
  "fetch_metadata",
  "fetch_logs",
  "query",
  "validate",
];

export const BLOCKED_MUTATION_ACTIONS: ConnectorAction[] = [
  "run",
  "trigger",
  "refresh",
  "pause",
  "resume",
  "restart",
  "rebuild",
  "deploy",
];

export function isReadOnlyConnectorAction(action: ConnectorAction) {
  return READ_ONLY_CONNECTOR_ACTIONS.includes(action);
}

export function isBlockedMutationAction(action: ConnectorAction) {
  return BLOCKED_MUTATION_ACTIONS.includes(action);
}


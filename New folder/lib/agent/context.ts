import { getConnection, listConnections } from "@/lib/connectors/vault";
import type { StoredConnection } from "@/lib/connectors/credentials";
import type { AgentConnectionContext, AgentContext, AgentRole } from "./types";

function toConnectionContext(connection: StoredConnection): AgentConnectionContext {
  return {
    connectionId: connection.connectionId,
    tool: connection.tool,
    family: connection.family,
    label: connection.label,
    authMethod: connection.authMethod,
    principal: connection.principal,
    target: connection.target,
    status: connection.status,
  };
}

function buildPipelineSummary(connections: AgentConnectionContext[]) {
  if (!connections.length) {
    return "No live connections are stored yet. Avoid claiming access to real systems and keep the answer generic.";
  }

  const familyCounts = connections.reduce<Record<string, number>>((acc, connection) => {
    acc[connection.family] = (acc[connection.family] || 0) + 1;
    return acc;
  }, {});

  const summary = Object.entries(familyCounts)
    .map(([family, count]) => `${count} ${family}`)
    .join(", ");

  return `Connected components currently cover: ${summary}. Use only these stored connections when grounding diagnosis or command suggestions.`;
}

export function buildAgentContext(params: {
  role: AgentRole;
  userGoal: string;
  selectedConnectionId?: string;
}) : AgentContext {
  const connections = listConnections().map(toConnectionContext);
  const selectedRaw = params.selectedConnectionId
    ? getConnection(params.selectedConnectionId)
    : null;

  return {
    role: params.role,
    userGoal: params.userGoal,
    selectedConnectionId: params.selectedConnectionId,
    selectedConnection: selectedRaw ? toConnectionContext(selectedRaw) : null,
    connections,
    pipelineSummary: buildPipelineSummary(connections),
    currentDate: new Date().toISOString(),
  };
}

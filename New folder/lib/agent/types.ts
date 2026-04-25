import type { AuthMethod, StoredConnection } from "@/lib/connectors/credentials";
import type { ConnectorAction, ConnectorFamily } from "@/lib/connectors/types";
import type { Citation } from "@/lib/product/types";

export type AgentRole =
  | "pipeline_operator"
  | "observability_analyst"
  | "remediation_operator";

export type AgentConnectionContext = {
  connectionId: string;
  tool: string;
  family: ConnectorFamily;
  label: string;
  authMethod: AuthMethod;
  principal?: string;
  target?: string;
  status: StoredConnection["status"];
};

export type AgentContext = {
  role: AgentRole;
  userGoal: string;
  selectedConnectionId?: string;
  selectedConnection?: AgentConnectionContext | null;
  connections: AgentConnectionContext[];
  pipelineSummary: string;
  currentDate: string;
};

export type CommandProposal = {
  tool: string;
  family: ConnectorFamily;
  action: ConnectorAction;
  target?: string;
  rationale: string;
  approvalRequired: boolean;
  generatedQuery?: string;   // deepseek-formulated SQL or API path
  userIntent?: string;       // original user message, passed through to executor
};

export type RedHerringAssessment = {
  likelyRedHerring: boolean;
  confidence: "low" | "medium" | "high";
  explanation: string;
};

export type AgentChatRequest = {
  message: string;
  role?: AgentRole;
  selectedConnectionId?: string;
  threadId?: string;
  silentUserMessage?: boolean;
};

export type AgentChatResponse = {
  message: string;
  context: AgentContext;
  commandProposals: CommandProposal[];
  redHerringAssessment: RedHerringAssessment;
  usedModels: {
    chat: string;
    redHerring: string;
    remedy?: string;
  };
  mode: "live" | "fallback";
  threadId?: string;
  citations?: Citation[];
  grounded?: boolean;
  confidence?: "low" | "medium" | "high";
  toolCalls?: Array<{
    tool: string;
    action: ConnectorAction | "retrieve" | "draft_rule";
    summary: string;
  }>;
  ui?: {
    showThinkingIndicator: boolean;
  };
};

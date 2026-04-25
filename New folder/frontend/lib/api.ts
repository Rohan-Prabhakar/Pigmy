import type { ChatResponse, DashboardResponse, IncidentDetailResponse, RecommendedActionType } from "./contracts";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";

export async function getDashboard(): Promise<DashboardResponse> {
  const response = await fetch(`${API_BASE_URL}/api/dashboard`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load dashboard");
  }
  return response.json();
}

export async function getIncidentDetail(incidentId: string): Promise<IncidentDetailResponse> {
  const response = await fetch(`${API_BASE_URL}/api/incidents/${incidentId}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("Failed to load incident detail");
  }
  return response.json();
}

export async function askIncidentQuestion(incidentId: string, message: string): Promise<ChatResponse> {
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incident_id: incidentId, message }),
  });
  if (!response.ok) {
    throw new Error("Failed to submit chat");
  }
  return response.json();
}

export async function runAction(incidentId: string, action: RecommendedActionType) {
  const response = await fetch(`${API_BASE_URL}/api/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ incident_id: incidentId, action }),
  });
  if (!response.ok) {
    throw new Error("Failed to execute action");
  }
  return response.json();
}

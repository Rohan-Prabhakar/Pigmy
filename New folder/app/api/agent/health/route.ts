import { NextResponse } from "next/server";
import {
  getChatModelCandidates,
  getOllamaBaseUrl,
  getPreferredChatModel,
  getPreferredRedHerringModel,
  getRedHerringModelCandidates,
} from "@/lib/agent/models";

export async function GET() {
  try {
    const response = await fetch(`${getOllamaBaseUrl()}/api/tags`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          status: response.status,
          chatModel: getPreferredChatModel(),
          redHerringModel: getPreferredRedHerringModel(),
          chatModelCandidates: getChatModelCandidates(),
          redHerringModelCandidates: getRedHerringModelCandidates(),
        },
        { status: 502 }
      );
    }

    const data = await response.json();
    return NextResponse.json({
      ok: true,
      chatModel: getPreferredChatModel(),
      redHerringModel: getPreferredRedHerringModel(),
      chatModelCandidates: getChatModelCandidates(),
      redHerringModelCandidates: getRedHerringModelCandidates(),
      ollama: data,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        chatModel: getPreferredChatModel(),
        redHerringModel: getPreferredRedHerringModel(),
        chatModelCandidates: getChatModelCandidates(),
        redHerringModelCandidates: getRedHerringModelCandidates(),
        error: error instanceof Error ? error.message : "Unknown Ollama error",
      },
      { status: 500 }
    );
  }
}

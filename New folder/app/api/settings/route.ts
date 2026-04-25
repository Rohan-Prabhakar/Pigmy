import { NextResponse } from "next/server";
import { hydrateCoreStateFromMongo, persistCoreStateToMongo } from "@/lib/platform/state-sync";
import { getSettings, saveSettings } from "@/lib/quality/store";

export async function GET() {
  await hydrateCoreStateFromMongo();
  return NextResponse.json({ settings: getSettings() });
}

export async function POST(request: Request) {
  await hydrateCoreStateFromMongo();
  const body = await request.json();
  const next = {
    ...getSettings(),
    ...body,
    modelRouting: {
      ...getSettings().modelRouting,
      ...(body.modelRouting ?? {}),
    },
    retrieval: {
      ...getSettings().retrieval,
      ...(body.retrieval ?? {}),
    },
    approvals: {
      ...getSettings().approvals,
      ...(body.approvals ?? {}),
    },
    mail: {
      ...getSettings().mail,
      ...(body.mail ?? {}),
    },
  };
  saveSettings(next);
  await persistCoreStateToMongo();
  return NextResponse.json({ settings: next });
}

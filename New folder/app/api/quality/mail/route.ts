import { NextResponse } from "next/server";
import { hydrateCoreStateFromMongo, persistCoreStateToMongo } from "@/lib/platform/state-sync";
import { getSettings, upsertMailSettings } from "@/lib/quality/store";

export async function GET() {
  await hydrateCoreStateFromMongo();
  return NextResponse.json({ mail: getSettings().mail });
}

export async function POST(request: Request) {
  await hydrateCoreStateFromMongo();
  const body = await request.json();
  const mail = upsertMailSettings({
    host: body.host,
    port: Number(body.port ?? 587),
    username: body.username,
    sender: body.sender,
    enabled: Boolean(body.enabled),
    recipients: Array.isArray(body.recipients) ? body.recipients : [],
    passwordSecretRef: body.password ? "smtp:password" : undefined,
  });

  await persistCoreStateToMongo();

  return NextResponse.json({ mail });
}

/**
 * s3-executor.ts
 *
 * Real S3 execution using @aws-sdk/client-s3.
 */

import { S3Client, ListObjectsV2Command, GetBucketLocationCommand } from "@aws-sdk/client-s3";
import type { StoredConnectionRecord } from "@/lib/product/types";
import type { ConnectorAction } from "@/lib/connectors/types";

export type ExecutorResult = {
  summary: string;
  evidence: string[];
  rows?: Record<string, unknown>[];
  live: boolean;
};

export async function executeS3(
  connection: StoredConnectionRecord,
  action: ConnectorAction
): Promise<ExecutorResult> {
  const bucket          = connection.details?.bucket ?? connection.target ?? "";
  const region          = connection.details?.region ?? "us-east-1";
  const accessKeyId     = connection.principal ?? "";
  const secretAccessKey = connection.secret ?? "";
  const prefix          = connection.details?.prefix ?? "";

  if (!bucket) {
    return {
      summary: "S3 credentials incomplete — bucket missing.",
      evidence: ["Set bucket in details."],
      live: false,
    };
  }

  const clientConfig = accessKeyId && secretAccessKey
    ? {
        region,
        credentials: { accessKeyId, secretAccessKey },
      }
    : { region }; // fall back to ambient credentials (IAM role / env vars)

  const s3 = new S3Client(clientConfig);

  try {
    if (action === "test_connection") {
      const locationCmd = new GetBucketLocationCommand({ Bucket: bucket });
      const loc = await s3.send(locationCmd);
      return {
        summary: `S3 bucket ${bucket} is accessible. Region: ${loc.LocationConstraint ?? "us-east-1"}.`,
        evidence: [`Bucket: ${bucket}`, `Region: ${loc.LocationConstraint ?? "us-east-1"}`],
        live: true,
      };
    }

    // All other actions: list objects
    const maxKeys = action === "fetch_metadata" || action === "discover" ? 50 : 20;
    const listCmd = new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix || undefined,
      MaxKeys: maxKeys,
      Delimiter: "/",
    });

    const res = await s3.send(listCmd);

    const prefixes = (res.CommonPrefixes ?? []).map((p) => ({
      type:         "prefix",
      key:          p.Prefix ?? "",
      lastModified: "",
      size:         0,
    }));

    const objects = (res.Contents ?? []).map((o) => ({
      type:         "object",
      key:          o.Key ?? "",
      lastModified: o.LastModified?.toISOString() ?? "",
      size:         o.Size ?? 0,
    }));

    const rows = [...prefixes, ...objects] as Record<string, unknown>[];
    const totalObjects = res.KeyCount ?? rows.length;

    return {
      summary: `S3 ${action}: ${totalObjects} object(s)/prefix(es) in s3://${bucket}/${prefix}.`,
      evidence: [
        `Bucket: ${bucket}`,
        `Region: ${region}`,
        `Prefix: ${prefix || "/"}`,
        ...rows.slice(0, 15).map((r) => `[${r.type}] ${r.key}  size=${r.size}  modified=${r.lastModified || "n/a"}`),
      ],
      rows,
      live: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      summary: `S3 live execution failed: ${message}`,
      evidence: [`Bucket: ${bucket}`, `Region: ${region}`, `Error: ${message}`],
      live: false,
    };
  }
}

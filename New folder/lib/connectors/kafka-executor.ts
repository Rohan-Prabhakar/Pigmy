/**
 * kafka-executor.ts
 *
 * Real Kafka execution using kafkajs.
 * Used for Apache Kafka connections. Confluent uses HTTP REST by default
 * but falls back here if bootstrap_servers are provided.
 */

import { Kafka, logLevel } from "kafkajs";
import type { StoredConnectionRecord } from "@/lib/product/types";
import type { ConnectorAction } from "@/lib/connectors/types";

export type ExecutorResult = {
  summary: string;
  evidence: string[];
  rows?: Record<string, unknown>[];
  live: boolean;
};

export async function executeKafka(
  connection: StoredConnectionRecord,
  action: ConnectorAction
): Promise<ExecutorResult> {
  const brokers   = (connection.details?.bootstrap_servers ?? connection.target ?? "").split(",").map((b) => b.trim()).filter(Boolean);
  const mechanism = (connection.details?.sasl_mechanism ?? "").toUpperCase();
  const username  = connection.principal ?? "";
  const password  = connection.secret ?? "";

  if (!brokers.length) {
    return {
      summary: "Kafka credentials incomplete — bootstrap_servers missing.",
      evidence: ["Set bootstrap_servers in details (comma-separated host:port list)."],
      live: false,
    };
  }

  const hasSasl = !!(mechanism && username && password);

  function buildSasl() {
    if (mechanism === "SCRAM-SHA-256") return { mechanism: "scram-sha-256" as const, username, password };
    if (mechanism === "SCRAM-SHA-512") return { mechanism: "scram-sha-512" as const, username, password };
    return { mechanism: "plain" as const, username, password };
  }

  const kafka = new Kafka({
    clientId: "pipeline-agent",
    brokers,
    ssl: hasSasl,
    sasl: hasSasl ? buildSasl() : undefined,
    connectionTimeout: 10_000,
    requestTimeout: 15_000,
    logLevel: logLevel.ERROR,
  });

  const admin = kafka.admin();

  try {
    await admin.connect();

    if (action === "fetch_logs" || action === "validate") {
      // Consumer group lag
      const groups = await admin.listGroups();
      const rows = groups.groups.slice(0, 20).map((g) => ({
        groupId:   g.groupId,
        protocolType: g.protocolType,
      }));
      return {
        summary: `Kafka: ${rows.length} consumer group(s) on ${brokers[0]}.`,
        evidence: [`Brokers: ${brokers.join(", ")}`, ...rows.map((r) => `groupId=${r.groupId}  protocol=${r.protocolType}`)],
        rows,
        live: true,
      };
    }

    // Default: list topics
    const topics = await admin.listTopics();
    const topicMeta = await admin.fetchTopicMetadata({ topics: topics.slice(0, 20) });
    const rows = topicMeta.topics.map((t) => ({
      name:       t.name,
      partitions: t.partitions.length,
    }));

    return {
      summary: `Kafka: ${topics.length} topic(s) on ${brokers[0]}.`,
      evidence: [`Brokers: ${brokers.join(", ")}`, ...rows.map((r) => `topic=${r.name}  partitions=${r.partitions}`)],
      rows,
      live: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      summary: `Kafka live execution failed: ${message}`,
      evidence: [`Brokers: ${brokers.join(", ")}`, `Error: ${message}`],
      live: false,
    };
  } finally {
    await admin.disconnect().catch(() => {});
  }
}

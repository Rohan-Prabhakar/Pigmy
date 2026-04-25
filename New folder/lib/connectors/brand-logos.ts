const CDN_BASE =
  "https://cdn.jsdelivr.net/gh/glincker/thesvg@main/public/icons";

export type BrandLogo = {
  slug: string;
  fallback: string;
};

const logoMap: Record<string, BrandLogo> = {
  airbyte: { slug: "airbyte", fallback: "AB" },
  fivetran: { slug: "fivetran", fallback: "FT" },
  meltano: { slug: "meltano", fallback: "MN" },
  dlt: { slug: "dlt", fallback: "DL" },
  singer: { slug: "singer", fallback: "SG" },
  stitch: { slug: "stitch", fallback: "ST" },
  "apache nifi": { slug: "apache-nifi", fallback: "Ni" },
  "aws glue": { slug: "aws-glue", fallback: "GL" },
  "azure data factory": { slug: "azure-data-factory", fallback: "AD" },
  matillion: { slug: "matillion", fallback: "MT" },
  estuary: { slug: "estuary", fallback: "ES" },
  "apache airflow": { slug: "apache-airflow", fallback: "AF" },
  prefect: { slug: "prefect", fallback: "PF" },
  dagster: { slug: "dagster", fallback: "DG" },
  luigi: { slug: "luigi", fallback: "LG" },
  "argo workflows": { slug: "argo", fallback: "AR" },
  kestra: { slug: "kestra", fallback: "KS" },
  "apache spark": { slug: "apache-spark", fallback: "SP" },
  pyspark: { slug: "pyspark", fallback: "PS" },
  databricks: { slug: "databricks", fallback: "DB" },
  dbt: { slug: "dbt", fallback: "dbt" },
  "apache flink": { slug: "apache-flink", fallback: "FK" },
  "apache beam": { slug: "apache-beam", fallback: "BM" },
  pandas: { slug: "pandas", fallback: "pd" },
  snowflake: { slug: "snowflake", fallback: "SF" },
  "google bigquery": { slug: "google-bigquery", fallback: "BQ" },
  "amazon redshift": { slug: "amazon-redshift", fallback: "RS" },
  "azure synapse": { slug: "azure-synapse", fallback: "AS" },
  clickhouse: { slug: "clickhouse", fallback: "CH" },
  duckdb: { slug: "duckdb", fallback: "DD" },
  trino: { slug: "trino", fallback: "TR" },
  presto: { slug: "presto", fallback: "PR" },
  postgresql: { slug: "postgresql", fallback: "PG" },
  mysql: { slug: "mysql", fallback: "MY" },
  "sql server": { slug: "microsoft-sql-server", fallback: "SS" },
  oracle: { slug: "oracle", fallback: "OR" },
  mongodb: { slug: "mongodb", fallback: "MG" },
  redis: { slug: "redis", fallback: "RD" },
  cassandra: { slug: "apache-cassandra", fallback: "CS" },
  elasticsearch: { slug: "elasticsearch", fallback: "ES" },
  "delta lake": { slug: "delta-lake", fallback: "DL" },
  "apache iceberg": { slug: "apache-iceberg", fallback: "IC" },
  "apache hudi": { slug: "apache-hudi", fallback: "HU" },
  "apache parquet": { slug: "apache-parquet", fallback: "PQ" },
  "apache avro": { slug: "apache-avro", fallback: "AV" },
  "apache orc": { slug: "apache-orc", fallback: "OR" },
  "apache arrow": { slug: "apache-arrow", fallback: "AW" },
  csv: { slug: "csv", fallback: "CSV" },
  "json / jsonl": { slug: "json", fallback: "JSON" },
  xml: { slug: "xml", fallback: "XML" },
  "amazon s3": { slug: "amazon-s3", fallback: "S3" },
  "google cloud storage": { slug: "google-cloud-storage", fallback: "GCS" },
  "azure blob / adls": { slug: "azure-blob-storage", fallback: "AZ" },
  hdfs: { slug: "hdfs", fallback: "HD" },
  minio: { slug: "minio", fallback: "MI" },
  "apache kafka": { slug: "apache-kafka", fallback: "KA" },
  confluent: { slug: "confluent", fallback: "CF" },
  "apache pulsar": { slug: "apache-pulsar", fallback: "PU" },
  "amazon kinesis": { slug: "amazon-kinesis", fallback: "KN" },
  "kafka connect": { slug: "kafka-connect", fallback: "KC" },
  "schema registry": { slug: "schema-registry", fallback: "SR" },
  "great expectations": { slug: "great-expectations", fallback: "GE" },
  soda: { slug: "soda", fallback: "SD" },
  elementary: { slug: "elementary", fallback: "EL" },
  "dbt tests": { slug: "dbt", fallback: "dbt" },
  tableau: { slug: "tableau", fallback: "TB" },
  "power bi": { slug: "power-bi", fallback: "PBI" },
  looker: { slug: "looker", fallback: "LK" },
  metabase: { slug: "metabase", fallback: "MB" },
  "apache superset": { slug: "apache-superset", fallback: "SU" },
  streamlit: { slug: "streamlit", fallback: "SL" },
  redash: { slug: "redash", fallback: "RD" },
  grafana: { slug: "grafana", fallback: "GF" },
  "google data studio": { slug: "google-data-studio", fallback: "GDS" },
  prometheus: { slug: "prometheus", fallback: "PM" },
  "grafana observability": { slug: "grafana", fallback: "GF" },
  opentelemetry: { slug: "open-telemetry", fallback: "OT" },
  datadog: { slug: "datadog", fallback: "DD" },
  docker: { slug: "docker", fallback: "DK" },
  kubernetes: { slug: "kubernetes", fallback: "K8" },
  terraform: { slug: "terraform", fallback: "TF" },
  jenkins: { slug: "jenkins", fallback: "JK" },
  "github actions": { slug: "github-actions", fallback: "GH" },
};

export function getBrandLogo(name: string): BrandLogo {
  return (
    logoMap[name.trim().toLowerCase()] ?? {
      slug: name.trim().toLowerCase().replace(/\s+/g, "-"),
      fallback: name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 3)
        .toUpperCase(),
    }
  );
}

export function getBrandLogoUrl(name: string) {
  const logo = getBrandLogo(name);
  return `${CDN_BASE}/${logo.slug}/default.svg`;
}

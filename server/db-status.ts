import "dotenv/config";
import { readFile } from "node:fs/promises";
import { createConnection, type RowDataPacket } from "mysql2/promise";
import { mysqlConnectionSettings } from "./mysql-config";
import {
  EXPECTED_DATABASE_TABLES,
  summarizeMigrationStatus,
  type MigrationJournalEntry,
} from "./db-migration-status";

type TableRow = RowDataPacket & { tableName: string };
type MigrationRow = RowDataPacket & { created_at: number | string };

async function verifyDatabaseState() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not configured in this process or .env.");
    process.exitCode = 1;
    return;
  }

  let connection: Awaited<ReturnType<typeof createConnection>> | undefined;
  try {
    const settings = mysqlConnectionSettings(databaseUrl, process.env.DATABASE_CA_CERT);
    const journalUrl = new URL("../drizzle/meta/_journal.json", import.meta.url);
    const journal = JSON.parse(await readFile(journalUrl, "utf8")) as { entries: MigrationJournalEntry[] };
    connection = await createConnection({ uri: settings.uri, ssl: settings.ssl });

    const [tableRows] = await connection.query<TableRow[]>(
      "SELECT TABLE_NAME AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
    );
    const existingTables = new Set(tableRows.map((row) => row.tableName));
    const migrationTablePresent = existingTables.has("__drizzle_migrations");
    let latestAppliedAt: number | null = null;

    if (migrationTablePresent) {
      const [migrationRows] = await connection.query<MigrationRow[]>(
        "SELECT created_at FROM `__drizzle_migrations` ORDER BY created_at DESC LIMIT 1",
      );
      if (migrationRows.length) latestAppliedAt = Number(migrationRows[0]!.created_at);
    }

    const result = summarizeMigrationStatus({
      journal: journal.entries,
      latestAppliedAt,
      migrationTablePresent,
      existingTables,
    });
    const presentTables = EXPECTED_DATABASE_TABLES.filter((table) => existingTables.has(table));

    console.log(JSON.stringify({
      target: {
        database: settings.database,
        isAivenHost: settings.host.toLowerCase().endsWith(".aivencloud.com"),
      },
      migrationTablePresent,
      latestAppliedAt,
      ...result,
      presentTables,
    }, null, 2));
    if (result.status === "partial_or_untracked" || result.status === "history_mismatch") {
      process.exitCode = 2;
    }
  } catch {
    console.error("Read-only database status check failed. Connection and driver details were withheld.");
    process.exitCode = 1;
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch {
        // Do not expose connection details from close errors.
      }
    }
  }
}

void verifyDatabaseState();

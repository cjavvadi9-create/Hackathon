import "dotenv/config";
import { createConnection } from "mysql2/promise";
import { mysqlConnectionSettings } from "./mysql-config";

async function checkDatabaseConnection() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not configured.");
    process.exitCode = 1;
    return;
  }

  let connection: Awaited<ReturnType<typeof createConnection>> | undefined;
  try {
    const settings = mysqlConnectionSettings(databaseUrl, process.env.DATABASE_CA_CERT);
    connection = await createConnection({ uri: settings.uri, ssl: settings.ssl });
    await connection.query("SELECT 1");
    console.log("MySQL connectivity verified with TLS certificate and hostname verification enabled.");
  } catch {
    console.error("MySQL connectivity failed. Check DATABASE_URL and DATABASE_CA_CERT; driver details were withheld.");
    process.exitCode = 1;
  } finally {
    if (connection) {
      try {
        await connection.end();
      } catch {
        // A close error should not expose connection details or mask the check result.
      }
    }
  }
}

void checkDatabaseConnection();

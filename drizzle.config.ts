import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { mysqlConnectionSettings } from "./server/mysql-config";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}
const { host, port, user, password, database, ssl } = mysqlConnectionSettings(
  connectionString,
  process.env.DATABASE_CA_CERT,
);

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    host,
    port,
    user,
    password,
    database,
    // Drizzle Kit accepts Node TLS options; preserve mysql2's extra verifyIdentity
    // flag so certificate chain and hostname checks both remain enabled.
    ssl: Object.assign({}, ssl),
  },
});

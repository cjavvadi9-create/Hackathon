export type VerifiedMysqlSslOptions = {
  ca?: string;
  rejectUnauthorized: true;
  verifyIdentity: true;
};

export type MysqlConnectionSettings = {
  uri: string;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: VerifiedMysqlSslOptions;
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error("DATABASE_URL contains invalid URL encoding");
  }
}

export function mysqlConnectionSettings(
  databaseUrl: string,
  caCertificate = process.env.DATABASE_CA_CERT,
): MysqlConnectionSettings {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid MySQL connection URL");
  }

  if (url.protocol !== "mysql:") {
    throw new Error("DATABASE_URL must use the mysql:// protocol");
  }

  // mysql2 does not support the MySQL CLI's `ssl-mode` URL parameter. Remove it
  // and configure the equivalent, strict TLS behavior with mysql2's `ssl` option.
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase() === "ssl-mode") url.searchParams.delete(key);
  }

  const ca = caCertificate?.replace(/\\n/g, "\n").trim();
  const ssl: VerifiedMysqlSslOptions = {
    rejectUnauthorized: true,
    verifyIdentity: true,
    ...(ca ? { ca } : {}),
  };

  return {
    uri: url.toString(),
    host: safeDecode(url.hostname),
    port: url.port ? Number(url.port) : 3306,
    user: safeDecode(url.username),
    password: safeDecode(url.password),
    database: safeDecode(url.pathname.replace(/^\//, "")),
    ssl,
  };
}

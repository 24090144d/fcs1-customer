#!/usr/bin/env node
const { Client } = require("pg");
const crypto = require("crypto");

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function qident(name) {
  return `"${String(name).replace(/"/g, "\"\"")}"`;
}

async function main() {
  const adminUrl = must("ADMIN_DATABASE_URL");
  const customer = (process.env.CUSTOMER_CODE || "").trim().toLowerCase();
  if (!customer) throw new Error("Missing CUSTOMER_CODE");

  const dbName = process.env.CUSTOMER_DB_NAME || `fcs1_${customer}`;
  const roleName = process.env.CUSTOMER_DB_USER || `app_user_${customer}`;
  const rolePassword =
    process.env.CUSTOMER_DB_PASSWORD ||
    `${crypto.randomBytes(18).toString("base64").replace(/[+=/]/g, "A")}9!a`;

  const adminClient = new Client({
    connectionString: adminUrl,
    ssl: { rejectUnauthorized: false },
  });
  await adminClient.connect();

  const dbExists = await adminClient.query(
    "select 1 from pg_database where datname = $1",
    [dbName]
  );
  if (dbExists.rowCount === 0) {
    await adminClient.query(`create database ${qident(dbName)}`);
  }

  const roleExists = await adminClient.query(
    "select 1 from pg_roles where rolname = $1",
    [roleName]
  );
  const escapedPassword = rolePassword.replace(/'/g, "''");
  if (roleExists.rowCount === 0) {
    await adminClient.query(
      `create role ${qident(roleName)} login password '${escapedPassword}'`
    );
  } else {
    await adminClient.query(
      `alter role ${qident(roleName)} with login password '${escapedPassword}'`
    );
  }

  await adminClient.query(
    `grant connect on database ${qident(dbName)} to ${qident(roleName)}`
  );
  await adminClient.end();

  const dbUrlObj = new URL(adminUrl);
  dbUrlObj.pathname = `/${dbName}`;
  const dbAdminUrl = dbUrlObj.toString();

  const dbClient = new Client({
    connectionString: dbAdminUrl,
    ssl: { rejectUnauthorized: false },
  });
  await dbClient.connect();

  await dbClient.query(`grant usage on schema public to ${qident(roleName)}`);
  await dbClient.query(
    `grant select, insert, update, delete on all tables in schema public to ${qident(roleName)}`
  );
  await dbClient.query(
    `grant usage, select, update on all sequences in schema public to ${qident(roleName)}`
  );
  await dbClient.query(
    `alter default privileges in schema public grant select, insert, update, delete on tables to ${qident(roleName)}`
  );
  await dbClient.query(
    `alter default privileges in schema public grant usage, select, update on sequences to ${qident(roleName)}`
  );
  await dbClient.end();

  const appUrl = new URL(dbAdminUrl);
  appUrl.username = encodeURIComponent(roleName);
  appUrl.password = encodeURIComponent(rolePassword);
  appUrl.searchParams.set("sslmode", "require");

  console.log(
    JSON.stringify(
      {
        customer,
        dbName,
        roleName,
        rolePassword,
        databaseUrl: appUrl.toString(),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});

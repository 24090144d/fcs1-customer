#!/usr/bin/env node
const fs = require("fs");
const { Client } = require("pg");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { ok: res.ok, status: res.status, body };
}

function pass(name, detail) {
  return { name, status: "PASS", detail };
}

function fail(name, detail) {
  return { name, status: "FAIL", detail };
}

function warn(name, detail) {
  return { name, status: "WARN", detail };
}

async function main() {
  const customerCode = required("CUSTOMER_CODE").toLowerCase();
  const customerName = required("CUSTOMER_NAME");
  const databaseUrl = required("DATABASE_URL");
  const vercelToken = required("VERCEL_TOKEN");
  const vercelOrgId = required("VERCEL_ORG_ID");
  const projectName = `fcs1-${customerCode}`;
  const appUrl = (process.env.APP_URL || "").trim();
  const domain = (process.env.DOMAIN || "").trim();
  const expectedDbName = process.env.EXPECTED_DB_NAME || `fcs1_${customerCode}`;

  const checks = [];
  const headers = { Authorization: `Bearer ${vercelToken}` };

  const projectResp = await fetchJson(
    `https://api.vercel.com/v9/projects/${projectName}?teamId=${vercelOrgId}`,
    { headers }
  );
  if (!projectResp.ok) {
    checks.push(fail("vercel_project_exists", `Project ${projectName} not found (${projectResp.status})`));
  } else {
    checks.push(pass("vercel_project_exists", `Project ${projectName} found`));
  }

  let deploymentsResp = { ok: false, body: { deployments: [] } };
  if (projectResp.ok) {
    deploymentsResp = await fetchJson(
      `https://api.vercel.com/v6/deployments?projectId=${projectResp.body.id}&teamId=${vercelOrgId}&limit=1`,
      { headers }
    );
    if (!deploymentsResp.ok || !deploymentsResp.body?.deployments?.length) {
      checks.push(fail("vercel_latest_deployment", "No deployments found"));
    } else {
      const dep = deploymentsResp.body.deployments[0];
      if (dep.readyState === "READY") {
        checks.push(pass("vercel_latest_deployment", `Latest deployment READY (${dep.url})`));
      } else {
        checks.push(fail("vercel_latest_deployment", `Latest deployment not ready: ${dep.readyState}`));
      }
    }
  }

  if (projectResp.ok) {
    const envResp = await fetchJson(
      `https://api.vercel.com/v9/projects/${projectName}/env?teamId=${vercelOrgId}`,
      { headers }
    );
    if (!envResp.ok) {
      checks.push(fail("vercel_env_vars", `Unable to list env vars (${envResp.status})`));
    } else {
      const keys = new Set((envResp.body?.envs || []).map((x) => x.key));
      const requiredKeys = ["DATABASE_URL", "CUSTOMER_CODE", "CUSTOMER_NAME"];
      const missing = requiredKeys.filter((k) => !keys.has(k));
      if (missing.length) {
        checks.push(fail("vercel_env_vars", `Missing env vars: ${missing.join(", ")}`));
      } else {
        checks.push(pass("vercel_env_vars", "Required env vars present"));
      }
    }
  }

  if (domain && projectResp.ok) {
    const domainResp = await fetchJson(
      `https://api.vercel.com/v9/projects/${projectName}/domains?teamId=${vercelOrgId}`,
      { headers }
    );
    if (!domainResp.ok) {
      checks.push(fail("customer_domain", `Unable to list domains (${domainResp.status})`));
    } else {
      const match = (domainResp.body?.domains || []).find((d) => d.name === domain);
      if (!match) {
        checks.push(fail("customer_domain", `Domain not found on project: ${domain}`));
      } else if (match.verified === false) {
        checks.push(warn("customer_domain", `Domain exists but not verified: ${domain}`));
      } else {
        checks.push(pass("customer_domain", `Domain configured: ${domain}`));
      }
    }
  }

  const db = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await db.connect();
  const dbName = (await db.query("select current_database() as db")).rows[0].db;
  const dbUser = (await db.query("select current_user as u")).rows[0].u;
  const tableCount = Number(
    (await db.query("select count(*)::int as c from information_schema.tables where table_schema='public'")).rows[0].c
  );
  await db.end();

  if (dbName !== expectedDbName) {
    checks.push(fail("database_target", `Connected to ${dbName}, expected ${expectedDbName}`));
  } else {
    checks.push(pass("database_target", `Connected to expected DB ${dbName}`));
  }
  checks.push(pass("database_user", `Connected as ${dbUser}`));
  if (tableCount >= 9) {
    checks.push(pass("database_schema_tables", `Public tables count = ${tableCount}`));
  } else {
    checks.push(fail("database_schema_tables", `Unexpected public tables count = ${tableCount}`));
  }

  if (appUrl) {
    const paths = ["/", "/onboarding", "/dashboard", "/api/nav/dashboards"];
    for (const path of paths) {
      const target = `${appUrl.replace(/\/$/, "")}${path}`;
      const res = await fetch(target, { redirect: "manual" });
      if (res.status >= 200 && res.status < 400) {
        checks.push(pass(`smoke_${path}`, `HTTP ${res.status}`));
      } else {
        checks.push(fail(`smoke_${path}`, `HTTP ${res.status}`));
      }
    }
  } else {
    checks.push(warn("smoke_http", "APP_URL not provided; skipped HTTP smoke checks"));
  }

  const passCount = checks.filter((c) => c.status === "PASS").length;
  const failCount = checks.filter((c) => c.status === "FAIL").length;
  const warnCount = checks.filter((c) => c.status === "WARN").length;
  const overall = failCount === 0 ? "PASS" : "FAIL";

  const report = {
    generatedAt: new Date().toISOString(),
    customerCode,
    customerName,
    projectName,
    appUrl: appUrl || null,
    domain: domain || null,
    overall,
    passCount,
    failCount,
    warnCount,
    checks,
  };

  fs.mkdirSync("reports", { recursive: true });
  fs.writeFileSync(`reports/onboarding-report-${customerCode}.json`, JSON.stringify(report, null, 2));

  const lines = [];
  lines.push(`# Onboarding Verification Report: ${customerCode}`);
  lines.push("");
  lines.push(`- Overall: **${overall}**`);
  lines.push(`- PASS: ${passCount}`);
  lines.push(`- WARN: ${warnCount}`);
  lines.push(`- FAIL: ${failCount}`);
  lines.push("");
  lines.push("| Check | Status | Detail |");
  lines.push("|---|---|---|");
  for (const c of checks) {
    lines.push(`| ${c.name} | ${c.status} | ${String(c.detail).replace(/\|/g, "\\|")} |`);
  }
  lines.push("");
  fs.writeFileSync(`reports/onboarding-report-${customerCode}.md`, lines.join("\n"));

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
  }

  if (overall !== "PASS") process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

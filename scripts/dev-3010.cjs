const { execSync, spawn } = require("node:child_process");

function getListeningPids(port) {
  if (process.platform !== "win32") return [];
  const out = execSync(`netstat -ano | findstr :${port}`, { encoding: "utf8" });
  const lines = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const pids = new Set();
  for (const line of lines) {
    if (!line.includes("LISTENING")) continue;
    const parts = line.replace(/\s+/g, " ").split(" ");
    const pid = parts[parts.length - 1];
    if (/^\d+$/.test(pid) && pid !== "0") pids.add(Number(pid));
  }
  return Array.from(pids);
}

function killPid(pid) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: "pipe" });
    console.log(`[dev-3010] Killed process ${pid} using port 3010.`);
    return true;
  } catch (err) {
    console.error(`[dev-3010] Failed to kill process ${pid}.`);
    if (err && err.stdout) process.stderr.write(String(err.stdout));
    if (err && err.stderr) process.stderr.write(String(err.stderr));
    return false;
  }
}

function freePort3010() {
  const port = 3010;
  let pids = [];
  try {
    pids = getListeningPids(port);
  } catch {
    return true;
  }
  if (pids.length === 0) return true;
  let allKilled = true;
  for (const pid of pids) {
    if (pid === process.pid) continue;
    const ok = killPid(pid);
    allKilled = allKilled && ok;
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const remaining = getListeningPids(port).filter((pid) => pid !== process.pid);
      if (remaining.length === 0) break;
    } catch {
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
  }
  try {
    const remaining = getListeningPids(port).filter((pid) => pid !== process.pid);
    if (remaining.length > 0) {
      console.error(`[dev-3010] Port 3010 still in use by PID(s): ${remaining.join(", ")}`);
      return false;
    }
  } catch {}
  return allKilled;
}

if (!freePort3010()) {
  console.error("[dev-3010] Could not free port 3010. Try running terminal as Administrator.");
  process.exit(1);
}

const child = process.platform === "win32"
  ? spawn("cmd.exe", ["/c", "set NEXT_DIST_DIR=.next-3010&& node_modules\\.bin\\next.cmd dev -p 3010"], {
      stdio: "inherit",
      shell: false,
    })
  : spawn("node_modules/.bin/next", ["dev", "-p", "3010"], {
      stdio: "inherit",
      shell: false,
      env: { ...process.env, NEXT_DIST_DIR: ".next-3010" },
    });

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const home = os.homedir();
const pgBin = process.env.PG_BIN || path.join(home, "Applications/Postgres.app/Contents/Versions/latest/bin");
const dataDir = process.env.PGDATA || path.join(home, ".postgres-data");
const logFile = path.join(dataDir, "server.log");
const port = process.env.PGPORT || "5432";

function run(bin, args) {
  const result = spawnSync(path.join(pgBin, bin), args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

fs.mkdirSync(dataDir, { recursive: true });

if (!fs.existsSync(path.join(dataDir, "PG_VERSION"))) {
  run("initdb", ["-D", dataDir]);
}

const status = spawnSync(path.join(pgBin, "pg_ctl"), ["-D", dataDir, "status"], {
  stdio: "pipe",
  encoding: "utf8"
});
if (status.status === 0) {
  console.log("PostgreSQL already running.");
  process.exit(0);
}

run("pg_ctl", ["-D", dataDir, "-l", logFile, "-o", `-p ${port}`, "start"]);

const { spawnSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const home = os.homedir();
const pgBin = process.env.PG_BIN || path.join(home, "Applications/Postgres.app/Contents/Versions/latest/bin");
const dataDir = process.env.PGDATA || path.join(home, ".postgres-data");

const result = spawnSync(path.join(pgBin, "pg_ctl"), ["-D", dataDir, "stop"], {
  stdio: "inherit"
});

if (result.status !== 0) process.exit(result.status || 1);

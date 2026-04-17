require("dotenv").config();

/**
 * Настройка пула pg. Для Railway / облачного Postgres по DATABASE_URL обычно нужен SSL.
 * Отключить: DATABASE_SSL=false или URL на localhost/127.0.0.1.
 */
function getDbPoolConfig() {
  if (process.env.DATABASE_URL) {
    const url = process.env.DATABASE_URL;
    const sslOff =
      process.env.DATABASE_SSL === "false" || /localhost|127\.0\.0\.1/.test(url);
    return {
      connectionString: url,
      ...(sslOff ? {} : { ssl: { rejectUnauthorized: false } })
    };
  }

  return {
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "taskbot",
    database: process.env.PGDATABASE || "taskbot",
    ...(process.env.PGPASSWORD ? { password: process.env.PGPASSWORD } : {})
  };
}

module.exports = { getDbPoolConfig };

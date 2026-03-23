import { databaseSchema, ensureSchema, getPool } from "../src/db.js";
import { refreshModelCatalog } from "../src/model-catalog.js";

async function main() {
  await ensureSchema();
  await refreshModelCatalog();
  const pool = await getPool();
  const result = await pool.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = $1
      ORDER BY table_name
    `,
    [databaseSchema()],
  );

  console.log(
    JSON.stringify(
      {
        schema: databaseSchema(),
        tables: result.rows.map((row) => row.table_name),
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

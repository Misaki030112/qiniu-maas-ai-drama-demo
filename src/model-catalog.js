import { databaseSchema, query } from "./db.js";
import { getSeedModelCatalog } from "./model-catalog-seed.js";

const schema = databaseSchema();

export function buildModelCatalogSeed() {
  return getSeedModelCatalog();
}

export async function refreshModelCatalog(options = {}) {
  const items = options.items || buildModelCatalogSeed();
  const queryFn = options.queryFn || query;
  const targetSchema = options.schema || schema;
  const modelIds = items.map((item) => item.modelId);

  for (const item of items) {
    await queryFn(
      `
        INSERT INTO ${targetSchema}.model_catalog (
          model_id,
          display_name,
          provider,
          category,
          family,
          capabilities,
          source,
          metadata,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, NOW())
        ON CONFLICT (model_id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          provider = EXCLUDED.provider,
          category = EXCLUDED.category,
          family = EXCLUDED.family,
          capabilities = EXCLUDED.capabilities,
          source = EXCLUDED.source,
          metadata = EXCLUDED.metadata,
          updated_at = EXCLUDED.updated_at
      `,
      [
        item.modelId,
        item.displayName,
        item.provider,
        item.category,
        item.family,
        JSON.stringify(item.capabilities || []),
        item.source,
        JSON.stringify(item.metadata || {}),
      ],
    );
  }

  await queryFn(
    `
      DELETE FROM ${targetSchema}.model_catalog
      WHERE model_id <> ALL($1::text[])
    `,
    [modelIds],
  );

  return items;
}

export async function listModelCatalog(options = {}) {
  const queryFn = options.queryFn || query;
  const targetSchema = options.schema || schema;
  const result = await queryFn(
    `
      SELECT
        model_id,
        display_name,
        provider,
        category,
        family,
        capabilities,
        source,
        metadata,
        updated_at
      FROM ${targetSchema}.model_catalog
      ORDER BY category ASC, provider ASC, display_name ASC
    `,
  );

  if (!result.rows.length) {
    await refreshModelCatalog({ queryFn, schema: targetSchema });
    return listModelCatalog({ queryFn, schema: targetSchema });
  }

  return result.rows.map((row) => ({
    modelId: row.model_id,
    displayName: row.display_name,
    provider: row.provider,
    category: row.category,
    family: row.family,
    capabilities: row.capabilities || [],
    source: row.source,
    metadata: row.metadata || {},
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at,
  }));
}

// 通过 SUPABASE_DB_URL 直连应用 supabase/migrations/*.sql（按文件名升序，幂等）。
// PostgREST 不能建表，故 DDL 必须直连 Postgres 执行。
//
// 用法：node --env-file=.env scripts/db-migrate.mjs
//   或：npm run db:migrate

import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "supabase", "migrations");

async function main() {
  const url = process.env.SUPABASE_DB_URL;
  if (!url || !url.trim()) {
    throw new Error("缺少 SUPABASE_DB_URL：无法应用迁移。请用 node --env-file=.env scripts/db-migrate.mjs 运行。");
  }

  const files = (await readdir(migrationsDir)).filter(name => name.endsWith(".sql")).sort();
  if (files.length === 0) {
    console.log("没有可应用的迁移文件。");
    return;
  }

  const sql = postgres(url, { ssl: "require", max: 1, connect_timeout: 15, idle_timeout: 5 });
  try {
    for (const file of files) {
      const text = await readFile(join(migrationsDir, file), "utf8");
      process.stdout.write(`applying ${file} ... `);
      await sql.unsafe(text); // 多语句 DDL；迁移内容受信（仓库内文件）
      console.log("ok");
    }
    const tables = await sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public' and table_name like 'aicrew_%'
      order by table_name
    `;
    console.log(`\n完成：应用 ${files.length} 个迁移；aicrew_ 表共 ${tables.length} 张：`);
    console.log(tables.map(row => "  - " + row.table_name).join("\n"));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

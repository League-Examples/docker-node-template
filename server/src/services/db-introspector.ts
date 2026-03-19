import { isSqlite } from './prisma';

interface TableSummary {
  name: string;
  rowCount: number;
}

interface ColumnMeta {
  name: string;
  type: string;
  nullable: boolean;
}

interface TableDetail {
  columns: ColumnMeta[];
  rows: any[];
  total: number;
  page: number;
  limit: number;
}

export interface DbIntrospector {
  listTables(): Promise<TableSummary[]>;
  getTableDetail(name: string, page: number, limit: number): Promise<TableDetail | null>;
}

class PostgresIntrospector implements DbIntrospector {
  constructor(private prisma: any) {}

  async listTables(): Promise<TableSummary[]> {
    const tables = await this.prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;

    return Promise.all(
      tables.map(async (t: { table_name: string }) => {
        const countResult = await this.prisma.$queryRawUnsafe(
          `SELECT count(*) FROM "${t.table_name}"`
        ) as [{ count: bigint }];
        return { name: t.table_name, rowCount: Number(countResult[0].count) };
      })
    );
  }

  async getTableDetail(name: string, page: number, limit: number): Promise<TableDetail | null> {
    const offset = (page - 1) * limit;

    const validTables = await this.prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name = ${name}
    `;
    if (validTables.length === 0) return null;

    const columns = await this.prisma.$queryRaw<{ column_name: string; data_type: string; is_nullable: string }[]>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${name}
      ORDER BY ordinal_position
    `;

    const countResult = await this.prisma.$queryRawUnsafe(
      `SELECT count(*) FROM "${name}"`
    ) as [{ count: bigint }];
    const total = Number(countResult[0].count);

    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM "${name}" ORDER BY 1 LIMIT ${limit} OFFSET ${offset}`
    );

    return {
      columns: columns.map((c) => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === 'YES',
      })),
      rows,
      total,
      page,
      limit,
    };
  }
}

class SqliteIntrospector implements DbIntrospector {
  constructor(private prisma: any) {}

  async listTables(): Promise<TableSummary[]> {
    const tables = await this.prisma.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_prisma%' AND name != 'sqlite_sequence' ORDER BY name`
    ) as { name: string }[];

    return Promise.all(
      tables.map(async (t: { name: string }) => {
        const countResult = await this.prisma.$queryRawUnsafe(
          `SELECT count(*) as count FROM "${t.name}"`
        ) as [{ count: number }];
        return { name: t.name, rowCount: Number(countResult[0].count) };
      })
    );
  }

  async getTableDetail(name: string, page: number, limit: number): Promise<TableDetail | null> {
    const offset = (page - 1) * limit;

    // Validate table exists
    const validTables = await this.prisma.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = '${name}'`
    ) as { name: string }[];
    if (validTables.length === 0) return null;

    // Get column metadata via PRAGMA
    const pragmaColumns = await this.prisma.$queryRawUnsafe(
      `PRAGMA table_info("${name}")`
    ) as { name: string; type: string; notnull: number }[];

    const countResult = await this.prisma.$queryRawUnsafe(
      `SELECT count(*) as count FROM "${name}"`
    ) as [{ count: number }];
    const total = Number(countResult[0].count);

    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM "${name}" ORDER BY 1 LIMIT ${limit} OFFSET ${offset}`
    );

    return {
      columns: pragmaColumns.map((c) => ({
        name: c.name,
        type: c.type || 'TEXT',
        nullable: c.notnull === 0,
      })),
      rows,
      total,
      page,
      limit,
    };
  }
}

export function createIntrospector(prisma: any): DbIntrospector {
  return isSqlite() ? new SqliteIntrospector(prisma) : new PostgresIntrospector(prisma);
}

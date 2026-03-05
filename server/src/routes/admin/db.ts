import { Router } from 'express';
import { prisma } from '../../services/prisma';

export const adminDbRouter = Router();

interface TableInfo {
  table_name: string;
}

interface ColumnInfo {
  column_name: string;
  data_type: string;
  is_nullable: string;
}

adminDbRouter.get('/db/tables', async (_req, res, next) => {
  try {
    const tables = await prisma.$queryRaw<TableInfo[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `;

    const result = await Promise.all(
      tables.map(async (t: TableInfo) => {
        const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
          `SELECT count(*) FROM "${t.table_name}"`
        );
        return {
          name: t.table_name,
          rowCount: Number(countResult[0].count),
        };
      })
    );

    res.json(result);
  } catch (err) {
    next(err);
  }
});

adminDbRouter.get('/db/tables/:name', async (req, res, next) => {
  try {
    const { name } = req.params;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    // Validate table name exists (SQL injection prevention)
    const validTables = await prisma.$queryRaw<TableInfo[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name = ${name}
    `;

    if (validTables.length === 0) {
      return res.status(404).json({ error: `Table '${name}' not found` });
    }

    // Get column metadata
    const columns = await prisma.$queryRaw<ColumnInfo[]>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${name}
      ORDER BY ordinal_position
    `;

    // Get total row count
    const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT count(*) FROM "${name}"`
    );
    const total = Number(countResult[0].count);

    // Get rows
    const rows = await prisma.$queryRawUnsafe(
      `SELECT * FROM "${name}" ORDER BY 1 LIMIT ${limit} OFFSET ${offset}`
    );

    res.json({
      columns: columns.map((c: ColumnInfo) => ({
        name: c.column_name,
        type: c.data_type,
        nullable: c.is_nullable === 'YES',
      })),
      rows,
      total,
      page,
      limit,
    });
  } catch (err) {
    next(err);
  }
});

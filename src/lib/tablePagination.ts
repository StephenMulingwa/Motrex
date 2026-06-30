export const TABLE_PAGE_SIZE = 10;

export function paginateRows<T>(rows: T[], page: number, pageSize = TABLE_PAGE_SIZE): T[] {
  const start = (page - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

export function totalPages(count: number, pageSize = TABLE_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(count / pageSize));
}

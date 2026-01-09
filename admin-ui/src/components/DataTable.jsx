import React from 'react';
import StatusBadge from './StatusBadge.jsx';

const DataTable = ({
  columns,
  rows,
  getRowId,
  onRowClick,
  isLoading,
  emptyText
}) => {
  if (isLoading) {
    return (
      <div className="ldc-card p-6 text-sm text-ldc-ink/70">Loading data...</div>
    );
  }

  if (!rows?.length) {
    return (
      <div className="ldc-card p-6 text-sm text-ldc-ink/70">{emptyText || 'No records yet.'}</div>
    );
  }

  return (
    <div className="ldc-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-white/70">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60"
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/60">
            {rows.map((row) => {
              const rowId = getRowId(row);
              return (
                <tr
                  key={rowId}
                  className={`transition ${onRowClick ? 'cursor-pointer hover:bg-white/80' : ''}`}
                  onClick={() => onRowClick?.(row)}
                >
                  {columns.map((col) => {
                    const rawValue = row?.[col.key];
                    const value = col.format ? col.format(rawValue, row) : rawValue ?? '-';
                    return (
                      <td key={col.key} className="px-4 py-3 text-ldc-ink/80">
                        {col.badge ? <StatusBadge value={rawValue} /> : value}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default DataTable;

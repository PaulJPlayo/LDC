import React from 'react';
import StatusBadge from './StatusBadge.jsx';

const renderThumbnail = (value, row) => {
  const src =
    value ||
    row?.thumbnail ||
    row?.image ||
    row?.cover_image ||
    row?.images?.[0]?.url ||
    row?.images?.[0] ||
    '';
  if (!src) {
    return (
      <div className="h-12 w-12 rounded-2xl bg-white/70 text-[10px] font-semibold uppercase tracking-[0.2em] text-ldc-ink/50 flex items-center justify-center">
        LDC
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={row?.title || row?.name || 'Item'}
      className="h-12 w-12 rounded-2xl object-cover shadow-glow"
      loading="lazy"
    />
  );
};

const DataTable = ({
  columns,
  rows,
  getRowId,
  onRowClick,
  isLoading,
  emptyText
}) => {
  const hasRows = Array.isArray(rows) && rows.length > 0;

  if (isLoading && !hasRows) {
    return (
      <div className="ldc-card p-6 text-sm text-ldc-ink/70">Loading data...</div>
    );
  }

  if (!hasRows) {
    return (
      <div className="ldc-card p-6 text-sm text-ldc-ink/70">{emptyText || 'No records yet.'}</div>
    );
  }

  return (
    <div className="ldc-card overflow-hidden">
      {isLoading ? (
        <div className="border-b border-white/60 bg-white/70 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-ldc-ink/60">
          Refreshing data...
        </div>
      ) : null}
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
                    const formattedValue = col.format ? col.format(rawValue, row) : rawValue;
                    const value = formattedValue ?? '-';
                    let cell = value;
                    if (col.badge || col.type === 'badge') {
                      cell = <StatusBadge value={rawValue} />;
                    } else if (col.type === 'thumbnail') {
                      cell = renderThumbnail(formattedValue ?? rawValue, row);
                    }
                    return (
                      <td key={col.key} className="px-4 py-3 text-ldc-ink/80">
                        {cell}
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

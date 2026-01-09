import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import DataTable from '../components/DataTable.jsx';
import { getList } from '../lib/api.js';

const getArrayFromPayload = (payload, key) => {
  if (!payload) return [];
  if (key && Array.isArray(payload[key])) return payload[key];
  const candidate = Object.values(payload).find((value) => Array.isArray(value));
  return candidate || [];
};

const getCountFromPayload = (payload, fallbackLength) => {
  if (!payload) return fallbackLength;
  if (typeof payload.count === 'number') return payload.count;
  return fallbackLength;
};

const ResourceList = ({ resource }) => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [rows, setRows] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const query = searchParams.get('q') || '';
  const limit = 20;
  const offset = (page - 1) * limit;

  const totalPages = Math.max(1, Math.ceil(count / limit));

  const columns = useMemo(() => resource.columns || [], [resource]);

  useEffect(() => {
    if (!resource) return;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const payload = await getList(resource.endpoint, {
          limit,
          offset,
          q: query || undefined
        });
        const items = getArrayFromPayload(payload, resource.listKey);
        setRows(items);
        setCount(getCountFromPayload(payload, items.length));
      } catch (err) {
        setRows([]);
        setCount(0);
        setError(err?.message || 'Unable to load data.');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [resource, offset, query]);

  const handleRowClick = (row) => {
    navigate(`${resource.path}/${row.id}`);
  };

  const handleSearch = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextQuery = String(formData.get('q') || '').trim();
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (nextQuery) {
        next.set('q', nextQuery);
      } else {
        next.delete('q');
      }
      next.set('page', '1');
      return next;
    });
  };

  const goToPage = (nextPage) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('page', String(nextPage));
      return next;
    });
  };

  return (
    <div>
      <PageHeader
        eyebrow="Collection"
        title={resource.label}
        subtitle={`Manage ${resource.label.toLowerCase()} with the LDC workflow.`}
        actions={
          <form className="flex items-center gap-2" onSubmit={handleSearch}>
            <input
              className="ldc-input h-11 w-48"
              name="q"
              placeholder={`Search ${resource.label.toLowerCase()}...`}
              defaultValue={query}
            />
            <button className="ldc-button-secondary" type="submit">
              Search
            </button>
          </form>
        }
      />

      {error ? <div className="mb-4 text-sm text-rose-600">{error}</div> : null}

      <DataTable
        columns={columns}
        rows={rows}
        getRowId={(row) => row.id}
        onRowClick={handleRowClick}
        isLoading={loading}
        emptyText={`No ${resource.label.toLowerCase()} found.`}
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-ldc-ink/70">
        <div>
          Showing {rows.length} of {count} records
        </div>
        <div className="flex items-center gap-2">
          <button
            className="ldc-button-secondary"
            type="button"
            onClick={() => goToPage(Math.max(1, page - 1))}
            disabled={page <= 1}
          >
            Previous
          </button>
          <span className="px-2">
            Page {page} of {totalPages}
          </span>
          <button
            className="ldc-button-secondary"
            type="button"
            onClick={() => goToPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
};

export default ResourceList;

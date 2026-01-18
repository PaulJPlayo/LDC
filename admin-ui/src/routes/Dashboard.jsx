import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
import DataTable from '../components/DataTable.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { getCount, getList } from '../lib/api.js';
import { formatDateTime, formatMoney, formatStatus } from '../lib/formatters.js';

const LOW_STOCK_THRESHOLD = 5;
const ORDER_SAMPLE_LIMIT = 200;

const getArrayFromPayload = (payload, key) => {
  if (!payload) return [];
  if (key && Array.isArray(payload[key])) return payload[key];
  const candidate = Object.values(payload).find((value) => Array.isArray(value));
  return candidate || [];
};

const toNumber = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const sortByDateDesc = (items, field = 'created_at') => {
  const list = Array.isArray(items) ? [...items] : [];
  return list.sort((a, b) => new Date(b?.[field] || 0) - new Date(a?.[field] || 0));
};

const getCurrencyCode = (orders) => {
  const match = (orders || []).find((order) => order?.currency_code);
  return match?.currency_code || 'usd';
};

const buildStatusBreakdown = (items, field, preferredOrder = []) => {
  const counts = {};
  const total = Array.isArray(items) ? items.length : 0;
  (items || []).forEach((item) => {
    const rawValue = item?.[field];
    const key = rawValue ? String(rawValue).toLowerCase() : 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  });

  const rows = [];
  const pushRow = (key) => {
    const count = counts[key];
    if (!count) return;
    rows.push({
      value: key,
      label: formatStatus(key),
      count,
      percent: total ? Math.round((count / total) * 100) : 0
    });
    delete counts[key];
  };

  preferredOrder.forEach((key) => pushRow(key));
  Object.keys(counts)
    .sort()
    .forEach((key) => pushRow(key));

  return { total, rows };
};

const buildLowStockRows = (items, threshold) => {
  return (items || [])
    .map((item) => {
      const stocked = toNumber(item?.stocked_quantity ?? item?.inventory_quantity ?? 0);
      const reserved = toNumber(item?.reserved_quantity ?? 0);
      const available = Math.max(0, stocked - reserved);
      return {
        ...item,
        stocked,
        reserved,
        available
      };
    })
    .filter((item) => item.available <= threshold)
    .sort((a, b) => a.available - b.available);
};

const SectionHeader = ({ eyebrow, title, subtitle }) => {
  return (
    <div className="mb-4">
      {eyebrow ? (
        <div className="text-xs font-semibold uppercase tracking-[0.3em] text-ldc-ink/50">
          {eyebrow}
        </div>
      ) : null}
      <h3 className="font-heading text-2xl text-ldc-ink">{title}</h3>
      {subtitle ? <p className="mt-1 text-sm text-ldc-ink/60">{subtitle}</p> : null}
    </div>
  );
};

const StatusSummaryCard = ({ title, items, total, note }) => {
  return (
    <div className="ldc-card p-5">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.3em] text-ldc-ink/50">
          {title}
        </div>
        <span className="text-xs text-ldc-ink/60">{total ? `${total} orders` : '-'}</span>
      </div>
      <div className="mt-4 space-y-3">
        {items.length ? (
          items.map((item) => (
            <div key={item.value}>
              <div className="flex items-center justify-between gap-3">
                <StatusBadge value={item.value} />
                <span className="text-xs text-ldc-ink/60">{item.count}</span>
              </div>
              <div className="mt-2 h-2 w-full rounded-full bg-white/70">
                <div
                  className="h-2 rounded-full bg-gradient-to-r from-ldc-pink via-ldc-mauve to-ldc-peach"
                  style={{ width: `${item.percent}%` }}
                />
              </div>
            </div>
          ))
        ) : (
          <div className="text-sm text-ldc-ink/60">No data yet.</div>
        )}
      </div>
      {note ? <div className="mt-3 text-xs text-ldc-ink/60">{note}</div> : null}
    </div>
  );
};

const Dashboard = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState({
    revenue30d: null,
    orders30d: null,
    aov30d: null,
    customers: null,
    draftOrders: null,
    returns: null,
    exchanges: null,
    lowStock: null,
    inventory: null,
    currency: 'usd'
  });
  const [orderStatusSummary, setOrderStatusSummary] = useState({ total: 0, rows: [] });
  const [paymentStatusSummary, setPaymentStatusSummary] = useState({ total: 0, rows: [] });
  const [fulfillmentStatusSummary, setFulfillmentStatusSummary] = useState({ total: 0, rows: [] });
  const [statusNote, setStatusNote] = useState('');
  const [recentOrders, setRecentOrders] = useState([]);
  const [recentDraftOrders, setRecentDraftOrders] = useState([]);
  const [recentReturns, setRecentReturns] = useState([]);
  const [recentExchanges, setRecentExchanges] = useState([]);
  const [lowStockItems, setLowStockItems] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [loadingOps, setLoadingOps] = useState(true);
  const [loadingInventory, setLoadingInventory] = useState(true);

  useEffect(() => {
    let isActive = true;

    const loadDashboard = async () => {
      setLoadingOrders(true);
      setLoadingOps(true);
      setLoadingInventory(true);
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);

      const results = await Promise.allSettled([
        getList('/admin/orders', { limit: ORDER_SAMPLE_LIMIT }),
        getCount('/admin/customers'),
        getList('/admin/draft-orders', { limit: 5 }),
        getCount('/admin/draft-orders'),
        getList('/admin/returns', { limit: 5 }),
        getCount('/admin/returns'),
        getList('/admin/exchanges', { limit: 5 }),
        getCount('/admin/exchanges'),
        getList('/admin/inventory-items', { limit: 200 })
      ]);

      if (!isActive) return;

      const [
        ordersResult,
        customersResult,
        draftOrdersResult,
        draftOrdersCountResult,
        returnsResult,
        returnsCountResult,
        exchangesResult,
        exchangesCountResult,
        inventoryResult
      ] = results;

      const nextStats = {
        revenue30d: null,
        orders30d: null,
        aov30d: null,
        customers: null,
        draftOrders: null,
        returns: null,
        exchanges: null,
        lowStock: null,
        inventory: null,
        currency: 'usd'
      };

      if (ordersResult.status === 'fulfilled') {
        const ordersPayload = ordersResult.value;
        const orders = getArrayFromPayload(ordersPayload, 'orders');
        const sortedOrders = sortByDateDesc(orders);
        setRecentOrders(sortedOrders.slice(0, 6));

        const recentWindow = orders.filter((order) => {
          const date = order?.created_at ? new Date(order.created_at) : null;
          return date && date >= cutoff;
        });
        const windowOrders = recentWindow.length ? recentWindow : orders;
        const revenue = windowOrders.reduce((sum, order) => sum + toNumber(order?.total), 0);
        const orderCount = windowOrders.length;
        const currency = getCurrencyCode(windowOrders.length ? windowOrders : orders);

        nextStats.revenue30d = orderCount ? revenue : 0;
        nextStats.orders30d = orderCount;
        nextStats.aov30d = orderCount ? Math.round(revenue / orderCount) : null;
        nextStats.currency = currency;

        setOrderStatusSummary(
          buildStatusBreakdown(windowOrders, 'status', [
            'pending',
            'completed',
            'canceled',
            'draft'
          ])
        );
        setPaymentStatusSummary(
          buildStatusBreakdown(windowOrders, 'payment_status', [
            'captured',
            'awaiting',
            'authorized',
            'not_paid',
            'refunded'
          ])
        );
        setFulfillmentStatusSummary(
          buildStatusBreakdown(windowOrders, 'fulfillment_status', [
            'not_fulfilled',
            'partially_fulfilled',
            'fulfilled',
            'shipped',
            'delivered'
          ])
        );

        const noteParts = [];
        if (recentWindow.length) {
          noteParts.push('Last 30 days');
        } else if (orders.length) {
          noteParts.push(`Latest ${orders.length} orders`);
        }
        if (ordersPayload?.count && ordersPayload.count > orders.length) {
          noteParts.push('Limited sample');
        }
        setStatusNote(noteParts.join(' | '));
      } else {
        setRecentOrders([]);
        setOrderStatusSummary({ total: 0, rows: [] });
        setPaymentStatusSummary({ total: 0, rows: [] });
        setFulfillmentStatusSummary({ total: 0, rows: [] });
        setStatusNote('');
      }
      setLoadingOrders(false);

      if (customersResult.status === 'fulfilled') {
        nextStats.customers = customersResult.value;
      }

      if (draftOrdersResult.status === 'fulfilled') {
        const draftOrdersPayload = draftOrdersResult.value;
        const draftOrders = getArrayFromPayload(draftOrdersPayload, 'draft_orders');
        setRecentDraftOrders(sortByDateDesc(draftOrders).slice(0, 5));
      } else {
        setRecentDraftOrders([]);
      }

      if (draftOrdersCountResult.status === 'fulfilled') {
        nextStats.draftOrders = draftOrdersCountResult.value;
      }

      if (returnsResult.status === 'fulfilled') {
        const returnsPayload = returnsResult.value;
        const returns = getArrayFromPayload(returnsPayload, 'returns');
        setRecentReturns(sortByDateDesc(returns).slice(0, 5));
      } else {
        setRecentReturns([]);
      }

      if (returnsCountResult.status === 'fulfilled') {
        nextStats.returns = returnsCountResult.value;
      }

      if (exchangesResult.status === 'fulfilled') {
        const exchangesPayload = exchangesResult.value;
        const exchanges = getArrayFromPayload(exchangesPayload, 'exchanges');
        setRecentExchanges(sortByDateDesc(exchanges).slice(0, 5));
      } else {
        setRecentExchanges([]);
      }

      if (exchangesCountResult.status === 'fulfilled') {
        nextStats.exchanges = exchangesCountResult.value;
      }

      setLoadingOps(false);

      if (inventoryResult.status === 'fulfilled') {
        const inventoryPayload = inventoryResult.value;
        const inventoryItems = getArrayFromPayload(inventoryPayload, 'inventory_items');
        const lowStock = buildLowStockRows(inventoryItems, LOW_STOCK_THRESHOLD);
        setLowStockItems(lowStock.slice(0, 6));
        nextStats.lowStock = lowStock.length;
        nextStats.inventory = inventoryPayload?.count || inventoryItems.length || null;
      } else {
        setLowStockItems([]);
      }
      setLoadingInventory(false);

      setStats(nextStats);
    };

    loadDashboard();

    return () => {
      isActive = false;
    };
  }, []);

  const revenueLabel =
    stats.revenue30d !== null ? formatMoney(stats.revenue30d, stats.currency) : '-';
  const aovLabel = stats.aov30d !== null ? formatMoney(stats.aov30d, stats.currency) : '-';

  return (
    <div>
      <PageHeader
        eyebrow="Studio Overview"
        title="Dashboard"
        subtitle="A quick pulse on the Lovetts LDC storefront, orders, and fulfillment flow."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Revenue (30d)"
          value={revenueLabel}
          description="Gross order totals in the last 30 days."
        />
        <StatCard
          label="Orders (30d)"
          value={stats.orders30d ?? '-'}
          description="Orders created in the last 30 days."
        />
        <StatCard
          label="Avg Order"
          value={aovLabel}
          description="Average order value for the current window."
        />
        <StatCard
          label="Customers"
          value={stats.customers ?? '-'}
          description="Total customer profiles on file."
        />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Draft Orders"
          value={stats.draftOrders ?? '-'}
          description="Drafts waiting to be converted."
        />
        <StatCard
          label="Returns"
          value={stats.returns ?? '-'}
          description="Return requests in the system."
        />
        <StatCard
          label="Exchanges"
          value={stats.exchanges ?? '-'}
          description="Open exchange requests."
        />
        <StatCard
          label={`Low Stock (<=${LOW_STOCK_THRESHOLD})`}
          value={stats.lowStock ?? '-'}
          description="Inventory items below threshold."
        />
      </div>

      <div className="mt-8 grid gap-4 xl:grid-cols-3">
        <StatusSummaryCard
          title="Order status"
          items={orderStatusSummary.rows}
          total={orderStatusSummary.total}
          note={statusNote}
        />
        <StatusSummaryCard
          title="Payment status"
          items={paymentStatusSummary.rows}
          total={paymentStatusSummary.total}
          note={statusNote}
        />
        <StatusSummaryCard
          title="Fulfillment status"
          items={fulfillmentStatusSummary.rows}
          total={fulfillmentStatusSummary.total}
          note={statusNote}
        />
      </div>

      <div className="mt-8">
        <SectionHeader
          eyebrow="Recent"
          title="Latest Orders"
          subtitle="Keep tabs on incoming purchases and payment status."
        />
        <DataTable
          columns={[
            { key: 'display_id', label: 'Order', format: (value) => (value ? `#${value}` : '-') },
            { key: 'email', label: 'Customer' },
            { key: 'status', label: 'Status', badge: true },
            { key: 'payment_status', label: 'Payment', badge: true },
            { key: 'fulfillment_status', label: 'Fulfillment', badge: true },
            {
              key: 'total',
              label: 'Total',
              format: (value, row) => formatMoney(value, row?.currency_code)
            },
            { key: 'created_at', label: 'Placed', format: formatDateTime }
          ]}
          rows={recentOrders}
          getRowId={(row) => row.id}
          onRowClick={(row) => navigate(`/orders/${row.id}`)}
          isLoading={loadingOrders}
          emptyText="No orders yet."
        />
      </div>

      <div className="mt-8 grid gap-4 xl:grid-cols-2">
        <div>
          <SectionHeader
            eyebrow="Inventory"
            title="Low Stock Items"
            subtitle={`Items with available stock at or below ${LOW_STOCK_THRESHOLD}.`}
          />
          <DataTable
            columns={[
              { key: 'thumbnail', label: 'Image', type: 'thumbnail' },
              { key: 'title', label: 'Item' },
              { key: 'sku', label: 'SKU' },
              { key: 'available', label: 'Available' },
              { key: 'stocked', label: 'Stocked' },
              { key: 'reserved', label: 'Reserved' }
            ]}
            rows={lowStockItems}
            getRowId={(row) => row.id}
            onRowClick={(row) => navigate(`/inventory/${row.id}`)}
            isLoading={loadingInventory}
            emptyText="No low-stock items found."
          />
        </div>
        <div>
          <SectionHeader
            eyebrow="Drafts"
            title="Draft Orders"
            subtitle="Follow up on quotes and manual orders."
          />
          <DataTable
            columns={[
              { key: 'display_id', label: 'Draft', format: (value) => (value ? `#${value}` : '-') },
              { key: 'email', label: 'Customer' },
              { key: 'status', label: 'Status', badge: true },
              {
                key: 'total',
                label: 'Total',
                format: (value, row) => formatMoney(value, row?.currency_code)
              },
              { key: 'created_at', label: 'Created', format: formatDateTime }
            ]}
            rows={recentDraftOrders}
            getRowId={(row) => row.id}
            onRowClick={(row) => navigate(`/draft-orders/${row.id}`)}
            isLoading={loadingOps}
            emptyText="No draft orders yet."
          />
        </div>
      </div>

      <div className="mt-8 grid gap-4 xl:grid-cols-2">
        <div>
          <SectionHeader
            eyebrow="Returns"
            title="Recent Returns"
            subtitle="Monitor return requests and refunds."
          />
          <DataTable
            columns={[
              { key: 'display_id', label: 'Return', format: (value) => (value ? `#${value}` : '-') },
              { key: 'status', label: 'Status', badge: true },
              {
                key: 'refund_amount',
                label: 'Refund',
                format: (value, row) => formatMoney(value, row?.currency_code)
              },
              { key: 'created_at', label: 'Created', format: formatDateTime }
            ]}
            rows={recentReturns}
            getRowId={(row) => row.id}
            onRowClick={(row) => navigate(`/returns/${row.id}`)}
            isLoading={loadingOps}
            emptyText="No returns yet."
          />
        </div>
        <div>
          <SectionHeader
            eyebrow="Exchanges"
            title="Recent Exchanges"
            subtitle="Track exchange requests and outbound items."
          />
          <DataTable
            columns={[
              {
                key: 'display_id',
                label: 'Exchange',
                format: (value, row) => (value ? `#${value}` : row?.id || '-')
              },
              { key: 'status', label: 'Status', badge: true },
              { key: 'created_at', label: 'Created', format: formatDateTime }
            ]}
            rows={recentExchanges}
            getRowId={(row) => row.id}
            onRowClick={(row) => navigate(`/exchanges/${row.id}`)}
            isLoading={loadingOps}
            emptyText="No exchanges yet."
          />
        </div>
      </div>
    </div>
  );
};

export default Dashboard;

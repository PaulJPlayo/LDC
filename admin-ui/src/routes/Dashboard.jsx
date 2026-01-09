import React, { useEffect, useState } from 'react';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
import DataTable from '../components/DataTable.jsx';
import { getCount, getList } from '../lib/api.js';
import { formatDateTime, formatMoney } from '../lib/formatters.js';

const Dashboard = () => {
  const [stats, setStats] = useState({
    orders: null,
    products: null,
    customers: null,
    inventory: null
  });
  const [recentOrders, setRecentOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(true);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const [orders, products, customers, inventory] = await Promise.all([
          getCount('/admin/orders'),
          getCount('/admin/products'),
          getCount('/admin/customers'),
          getCount('/admin/inventory-items')
        ]);
        setStats({ orders, products, customers, inventory });
      } catch (error) {
        setStats({ orders: '-', products: '-', customers: '-', inventory: '-' });
      }
    };

    const loadOrders = async () => {
      setLoadingOrders(true);
      try {
        const payload = await getList('/admin/orders', { limit: 5, offset: 0 });
        setRecentOrders(payload?.orders || payload?.order || payload?.items || []);
      } catch (error) {
        setRecentOrders([]);
      } finally {
        setLoadingOrders(false);
      }
    };

    loadStats();
    loadOrders();
  }, []);

  return (
    <div>
      <PageHeader
        eyebrow="Studio Overview"
        title="Dashboard"
        subtitle="A quick pulse on the Lovetts LDC storefront and fulfillment flow."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Orders" value={stats.orders ?? '-'} description="Total orders in the system." />
        <StatCard label="Products" value={stats.products ?? '-'} description="Published catalog items." />
        <StatCard label="Customers" value={stats.customers ?? '-'} description="Unique customer profiles." />
        <StatCard label="Inventory" value={stats.inventory ?? '-'} description="Inventory records tracked." />
      </div>

      <div className="mt-8">
        <PageHeader
          eyebrow="Recent"
          title="Latest Orders"
          subtitle="Stay on top of new purchases and payment status."
        />
        <DataTable
          columns={[
            { key: 'display_id', label: 'Order', format: (value) => (value ? `#${value}` : '-') },
            { key: 'email', label: 'Customer' },
            { key: 'status', label: 'Status', badge: true },
            { key: 'total', label: 'Total', format: (value, row) => formatMoney(value, row?.currency_code) },
            { key: 'created_at', label: 'Placed', format: formatDateTime }
          ]}
          rows={recentOrders}
          getRowId={(row) => row.id}
          isLoading={loadingOrders}
          emptyText="No orders yet."
        />
      </div>
    </div>
  );
};

export default Dashboard;

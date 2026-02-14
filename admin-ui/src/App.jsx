import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './state/auth.jsx';
import AdminShell from './components/AdminShell.jsx';
import Login from './routes/Login.jsx';
import InviteAccept from './routes/InviteAccept.jsx';
import Dashboard from './routes/Dashboard.jsx';
import DraftOrderCreate from './routes/DraftOrderCreate.jsx';
import ProductCreate from './routes/ProductCreate.jsx';
import ResourceList from './routes/ResourceList.jsx';
import ResourceDetail from './routes/ResourceDetail.jsx';
import Settings from './routes/Settings.jsx';
import StorefrontLayout from './routes/StorefrontLayout.jsx';
import { resources } from './data/resources.js';

const RequireAuth = ({ children }) => {
  const { status } = useAuth();
  if (status === 'checking') {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-ldc-ink/70">
        Loading studio...
      </div>
    );
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace />;
  }
  return children;
};

const App = () => {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/invite" element={<InviteAccept />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <AdminShell />
          </RequireAuth>
        }
      >
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="storefront-layout" element={<StorefrontLayout />} />
        <Route path="settings" element={<Settings />} />
        <Route path="draft-orders/new" element={<DraftOrderCreate />} />
        <Route path="products/new" element={<ProductCreate />} />
        {resources.map((resource) => (
          <Route
            key={resource.id}
            path={resource.path.replace(/^\//, '')}
            element={<ResourceList resource={resource} />}
          />
        ))}
        {resources.map((resource) => (
          <Route
            key={`${resource.id}-detail`}
            path={`${resource.path.replace(/^\//, '')}/:id`}
            element={<ResourceDetail resource={resource} />}
          />
        ))}
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;

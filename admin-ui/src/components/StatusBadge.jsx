import React from 'react';
import { formatStatus } from '../lib/formatters.js';

const toneMap = {
  completed: 'bg-emerald-100 text-emerald-700',
  paid: 'bg-emerald-100 text-emerald-700',
  captured: 'bg-emerald-100 text-emerald-700',
  fulfilled: 'bg-emerald-100 text-emerald-700',
  shipped: 'bg-emerald-100 text-emerald-700',
  delivered: 'bg-emerald-100 text-emerald-700',
  received: 'bg-emerald-100 text-emerald-700',
  success: 'bg-emerald-100 text-emerald-700',
  authorized: 'bg-amber-100 text-amber-700',
  pending: 'bg-amber-100 text-amber-700',
  awaiting: 'bg-amber-100 text-amber-700',
  packed: 'bg-amber-100 text-amber-700',
  processing: 'bg-amber-100 text-amber-700',
  requires_action: 'bg-amber-100 text-amber-700',
  requires_more: 'bg-amber-100 text-amber-700',
  partially_authorized: 'bg-amber-100 text-amber-700',
  partially_captured: 'bg-amber-100 text-amber-700',
  partially_refunded: 'bg-amber-100 text-amber-700',
  partially_fulfilled: 'bg-amber-100 text-amber-700',
  partially_shipped: 'bg-amber-100 text-amber-700',
  partially_delivered: 'bg-amber-100 text-amber-700',
  partially_received: 'bg-amber-100 text-amber-700',
  requested: 'bg-amber-100 text-amber-700',
  admin: 'bg-emerald-100 text-emerald-700',
  member: 'bg-slate-100 text-slate-600',
  canceled: 'bg-rose-100 text-rose-700',
  refunded: 'bg-rose-100 text-rose-700',
  failed: 'bg-rose-100 text-rose-700',
  failure: 'bg-rose-100 text-rose-700',
  not_paid: 'bg-slate-100 text-slate-600',
  not_fulfilled: 'bg-slate-100 text-slate-600',
  draft: 'bg-slate-100 text-slate-600',
  archived: 'bg-slate-100 text-slate-600',
  read: 'bg-slate-100 text-slate-600',
  unread: 'bg-ldc-plum/20 text-ldc-plum'
};

const StatusBadge = ({ value }) => {
  const key = String(value || '').toLowerCase();
  const tone = toneMap[key] || 'bg-white/70 text-ldc-ink/70';
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${tone}`}>
      {formatStatus(value)}
    </span>
  );
};

export default StatusBadge;

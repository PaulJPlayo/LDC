import React from 'react';
import { formatStatus } from '../lib/formatters.js';

const toneMap = {
  completed: 'bg-emerald-100 text-emerald-700',
  paid: 'bg-emerald-100 text-emerald-700',
  captured: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  requires_more: 'bg-amber-100 text-amber-700',
  canceled: 'bg-rose-100 text-rose-700',
  refunded: 'bg-rose-100 text-rose-700',
  draft: 'bg-slate-100 text-slate-600'
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

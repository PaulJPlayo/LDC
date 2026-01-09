import React from 'react';

const StatCard = ({ label, value, description }) => {
  return (
    <div className="ldc-card p-5">
      <div className="text-xs font-semibold uppercase tracking-[0.3em] text-ldc-ink/50">{label}</div>
      <div className="mt-2 text-3xl font-heading text-ldc-ink">{value}</div>
      {description ? <p className="mt-2 text-sm text-ldc-ink/60">{description}</p> : null}
    </div>
  );
};

export default StatCard;

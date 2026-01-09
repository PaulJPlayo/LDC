import React from 'react';

const PageHeader = ({ eyebrow, title, subtitle, actions }) => {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow ? (
          <div className="text-xs font-semibold uppercase tracking-[0.3em] text-ldc-ink/50">
            {eyebrow}
          </div>
        ) : null}
        <h2 className="font-heading text-3xl text-ldc-ink">{title}</h2>
        {subtitle ? <p className="mt-2 text-sm text-ldc-ink/70">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-3">{actions}</div> : null}
    </div>
  );
};

export default PageHeader;

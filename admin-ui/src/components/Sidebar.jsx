import React from 'react';
import { NavLink } from 'react-router-dom';
import { resourceGroups, resourceMap } from '../data/resources.js';

const Sidebar = ({ isOpen, onClose }) => {
  return (
    <>
      <div
        className={`fixed inset-0 z-20 bg-ldc-midnight/40 backdrop-blur-sm transition-opacity md:hidden ${
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={onClose}
      />
      <aside
        className={`ldc-panel fixed inset-y-0 left-0 z-30 w-72 max-w-[85vw] overflow-y-auto p-6 transition-transform md:static md:translate-x-0 ${
          isOpen ? 'translate-x-4' : '-translate-x-full md:translate-x-0'
        }`}
      >
        <div className="flex flex-col gap-6">
          <div>
            <span className="ldc-badge">LDC Admin</span>
            <h2 className="mt-4 font-heading text-2xl text-ldc-ink">Studio Console</h2>
            <p className="mt-2 text-sm text-ldc-ink/70">
              Manage orders, inventory, and the full Lovetts LDC catalog.
            </p>
          </div>

          <nav className="flex flex-col gap-5">
            <NavLink
              to="/dashboard"
              className={({ isActive }) =>
                `flex items-center justify-between rounded-2xl px-4 py-3 text-sm font-semibold tracking-wide transition ${
                  isActive
                    ? 'bg-white text-ldc-ink shadow-glow'
                    : 'text-ldc-ink/80 hover:bg-white/60'
                }`
              }
            >
              Dashboard
              <span className="text-xs uppercase tracking-[0.2em] text-ldc-ink/50">Home</span>
            </NavLink>

            {resourceGroups.map((group) => (
              <div key={group.label} className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-[0.25em] text-ldc-ink/50">
                  {group.label}
                </div>
                <div className="flex flex-col gap-2">
                  {group.items.map((id) => {
                    const resource = resourceMap[id];
                    if (!resource) return null;
                    return (
                      <NavLink
                        key={resource.id}
                        to={resource.path}
                        className={({ isActive }) =>
                          `rounded-2xl px-4 py-3 text-sm font-medium transition ${
                            isActive
                              ? 'bg-white text-ldc-ink shadow-glow'
                              : 'text-ldc-ink/70 hover:bg-white/60'
                          }`
                        }
                      >
                        {resource.label}
                      </NavLink>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;

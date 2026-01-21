import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { formatDateTime } from '../lib/formatters.js';
import { formatApiError, getList } from '../lib/api.js';
import {
  NOTIFICATIONS_LAST_READ_KEY,
  filterHiddenNotifications,
  getHiddenIdSet,
  getReadIdSet,
  isNotificationUnread,
  notifyNotificationChange,
  setHiddenIdSet,
  setReadIdSet,
  subscribeNotificationChanges
} from '../lib/notifications.js';
const MEDIA_BASE = (import.meta.env.VITE_MEDUSA_BACKEND_URL || 'https://api.lovettsldc.com')
  .replace(/\/$/, '');

const isLocalHost = (host) =>
  ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(String(host || '').toLowerCase());

const normalizeBackendUrl = (url) => {
  if (!/^https?:\/\//i.test(url)) return url;
  try {
    const parsed = new URL(url);
    if (isLocalHost(parsed.hostname)) {
      return `${MEDIA_BASE}${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    return url;
  } catch {
    return url;
  }
};

const resolveFileUrl = (url) => {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return normalizeBackendUrl(url);
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${MEDIA_BASE}${url}`;
  if (!url.includes('://') && url.includes('/')) return `${MEDIA_BASE}/${url}`;
  return `${MEDIA_BASE}/${url}`;
};

const getArrayFromPayload = (payload, key) => {
  if (!payload) return [];
  if (key && Array.isArray(payload[key])) return payload[key];
  const candidate = Object.values(payload).find((value) => Array.isArray(value));
  return candidate || [];
};

const formatRelativeTime = (value) => {
  if (!value) return '-';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '-';
  const diffMs = Date.now() - timestamp;
  if (!Number.isFinite(diffMs)) return '-';
  if (diffMs < 0) return formatDateTime(value);
  const diffSeconds = Math.round(diffMs / 1000);
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return formatDateTime(value);
};

const getNotificationTitle = (notice) =>
  notice?.data?.title || notice?.data?.subject || notice?.template || 'Notification';

const getNotificationMessage = (notice) =>
  notice?.data?.description || notice?.data?.message || notice?.data?.text || '';

const getNotificationFile = (notice) => {
  const file = notice?.data?.file || {};
  const url = resolveFileUrl(file?.url || notice?.data?.file_url || '');
  if (!url) return null;
  return {
    url,
    label: file?.filename || file?.name || 'Download'
  };
};

const NotificationsDrawer = () => {
  const [open, setOpen] = useState(false);
  const [lastReadAt, setLastReadAt] = useState(() =>
    typeof window === 'undefined'
      ? null
      : window.localStorage.getItem(NOTIFICATIONS_LAST_READ_KEY)
  );
  const [readIds, setReadIds] = useState(() => getReadIdSet());
  const [hiddenIds, setHiddenIds] = useState(() => getHiddenIdSet());
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const lastReadTimestamp = lastReadAt ? Date.parse(lastReadAt) : 0;

  const visibleNotifications = useMemo(
    () => filterHiddenNotifications(notifications, hiddenIds),
    [notifications, hiddenIds]
  );

  const hasUnread = useMemo(() => {
    if (!visibleNotifications.length) return false;
    return visibleNotifications.some((notice) =>
      isNotificationUnread(notice, lastReadTimestamp, readIds)
    );
  }, [visibleNotifications, lastReadTimestamp, readIds]);

  const notificationRows = useMemo(
    () =>
      visibleNotifications
        .map((notice) => ({
          id: notice?.id || `${notice?.created_at || 'notice'}`,
          title: getNotificationTitle(notice),
          message: getNotificationMessage(notice),
          channel: notice?.channel || notice?.data?.channel || '',
          status: notice?.status || '',
          created_at: notice?.created_at,
          file: getNotificationFile(notice)
        }))
        .filter((notice) => notice.title),
    [visibleNotifications]
  );

  const fetchNotifications = async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await getList('/admin/notifications', {
        limit: 20,
        offset: 0,
        order: '-created_at'
      });
      setNotifications(getArrayFromPayload(payload, 'notifications'));
    } catch (err) {
      setError(formatApiError(err, 'Unable to load notifications.'));
    } finally {
      setLoading(false);
    }
  };

  const handleMarkRead = (id) => {
    if (!id) return;
    const next = new Set(readIds);
    next.add(id);
    setReadIds(next);
    setReadIdSet(next);
  };

  const handleMarkAllRead = () => {
    const latestTimestamp = notificationRows.reduce((latest, notice) => {
      const ts = Date.parse(notice?.created_at || '');
      if (!Number.isFinite(ts)) return latest;
      return ts > latest ? ts : latest;
    }, 0);
    const timestamp = latestTimestamp
      ? new Date(latestTimestamp).toISOString()
      : new Date().toISOString();
    window.localStorage.setItem(NOTIFICATIONS_LAST_READ_KEY, timestamp);
    setLastReadAt(timestamp);
    const cleared = new Set();
    setReadIds(cleared);
    setReadIdSet(cleared);
    notifyNotificationChange();
  };

  const handleClearNotifications = (ids) => {
    if (!Array.isArray(ids) || !ids.length) return;
    const next = new Set(hiddenIds);
    ids.forEach((id) => {
      if (id) next.add(id);
    });
    setHiddenIds(next);
    setHiddenIdSet(next);
  };

  const handleClearRead = () => {
    const idsToClear = notificationRows
      .filter((notice) => !isNotificationUnread(notice, lastReadTimestamp, readIds))
      .map((notice) => notice.id)
      .filter(Boolean);
    handleClearNotifications(idsToClear);
  };

  const handleClearAll = () => {
    const idsToClear = notificationRows.map((notice) => notice.id).filter(Boolean);
    handleClearNotifications(idsToClear);
  };

  const handleOpenChange = (nextOpen) => {
    if (nextOpen) {
      setOpen(true);
      return;
    }
    setOpen(false);
  };

  useEffect(() => {
    fetchNotifications();
    const interval = window.setInterval(fetchNotifications, 60000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const sync = () => {
      setReadIds(getReadIdSet());
      setHiddenIds(getHiddenIdSet());
      setLastReadAt(window.localStorage.getItem(NOTIFICATIONS_LAST_READ_KEY));
    };
    return subscribeNotificationChanges(sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    fetchNotifications();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() !== 'n') return;
      event.preventDefault();
      handleOpenChange(!open);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const overlay = open ? (
    <div className="fixed inset-0 z-[999]">
      <button
        type="button"
        className="absolute inset-0 bg-ldc-midnight/50"
        onClick={() => handleOpenChange(false)}
        aria-label="Close notifications"
      />
      <div className="absolute right-4 top-24 flex h-[calc(100vh-7.5rem)] w-[92vw] max-w-[420px] flex-col overflow-hidden ldc-panel p-5 md:right-8 z-[1000]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.3em] text-ldc-ink/50">
              Notifications
            </div>
            <p className="mt-1 text-sm text-ldc-ink/70">
              LDC activity updates and exports.
            </p>
          </div>
          <button
            type="button"
            className="ldc-button-secondary"
            onClick={() => handleOpenChange(false)}
          >
            Close
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-ldc-ink/60">
          <span>{hasUnread ? 'New activity available.' : 'All caught up.'}</span>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="font-semibold text-ldc-plum disabled:text-ldc-ink/40"
              onClick={handleMarkAllRead}
              disabled={!notificationRows.length}
            >
              Mark all read
            </button>
            <button
              type="button"
              className="font-semibold text-ldc-plum disabled:text-ldc-ink/40"
              onClick={handleClearRead}
              disabled={!notificationRows.length}
            >
              Clear read
            </button>
            <button
              type="button"
              className="font-semibold text-ldc-plum disabled:text-ldc-ink/40"
              onClick={handleClearAll}
              disabled={!notificationRows.length}
            >
              Clear all
            </button>
            <button
              type="button"
              className="font-semibold text-ldc-plum disabled:text-ldc-ink/40"
              onClick={fetchNotifications}
              disabled={loading}
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        {error ? <div className="mt-3 text-sm text-rose-600">{error}</div> : null}

        <div className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
          {loading && !notificationRows.length ? (
            <div className="text-sm text-ldc-ink/60">Loading notifications...</div>
          ) : null}
          {!loading && !notificationRows.length ? (
            <div className="rounded-2xl bg-white/70 p-4 text-sm text-ldc-ink/60">
              You do not have any notifications yet.
            </div>
          ) : null}
          {notificationRows.map((notice, index) => {
            const unread = isNotificationUnread(notice, lastReadTimestamp, readIds);
            return (
              <div key={notice.id || `${notice.title}-${index}`} className="rounded-2xl bg-white/80 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-ldc-ink">{notice.title}</div>
                    {notice.message ? (
                      <div className="mt-1 whitespace-pre-line text-sm text-ldc-ink/70">
                        {notice.message}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-ldc-ink/60">
                    <span>{formatRelativeTime(notice.created_at)}</span>
                    {unread ? <span className="h-2 w-2 rounded-full bg-ldc-plum" /> : null}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {notice.channel ? (
                    <span className="ldc-badge text-ldc-ink/70">{notice.channel}</span>
                  ) : null}
                  {notice.status ? (
                    <span className="ldc-badge text-ldc-ink/70">{notice.status}</span>
                  ) : null}
                </div>

                {notice.file ? (
                  <div className="mt-3">
                    <a
                      href={notice.file.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-ldc-plum underline decoration-ldc-plum/40 underline-offset-4"
                    >
                      {notice.file.label}
                    </a>
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                  {unread ? (
                    <button
                      type="button"
                      className="font-semibold text-ldc-plum"
                      onClick={() => handleMarkRead(notice.id)}
                    >
                      Mark read
                    </button>
                  ) : (
                    <span className="text-ldc-ink/50">Read</span>
                  )}
                  <button
                    type="button"
                    className="font-semibold text-ldc-plum"
                    onClick={() => handleClearNotifications([notice.id])}
                  >
                    Clear
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <Link className="text-sm font-semibold text-ldc-plum" to="/notifications">
            View all notifications
          </Link>
          <div className="text-xs text-ldc-ink/50">Shortcut: Ctrl/Cmd + N</div>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="relative">
      <button
        type="button"
        className="relative inline-flex items-center justify-center rounded-full bg-white/80 px-4 py-2 text-sm font-semibold text-ldc-ink shadow-soft transition hover:bg-white"
        onClick={() => handleOpenChange(true)}
        aria-label="Open notifications"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9z" />
          <path d="M13.73 21a2 2 0 01-3.46 0" />
        </svg>
        {hasUnread && !open ? (
          <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-ldc-plum shadow-glow" />
        ) : null}
      </button>
      {open && typeof document !== 'undefined' && document.body
        ? createPortal(overlay, document.body)
        : null}
    </div>
  );
};

export default NotificationsDrawer;

const READ_KEY = 'ldcNotificationReadIds';
const HIDDEN_KEY = 'ldcNotificationHiddenIds';
export const NOTIFICATIONS_LAST_READ_KEY = 'notificationsLastReadAt';
const CHANGE_EVENT = 'ldc-notifications-change';

const safeParseArray = (value) => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const loadIdSet = (key) => {
  if (typeof window === 'undefined') return new Set();
  return new Set(safeParseArray(window.localStorage.getItem(key)));
};

const saveIdSet = (key, set) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(Array.from(set)));
  notifyNotificationChange();
};

export const notifyNotificationChange = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

export const subscribeNotificationChanges = (handler) => {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
};

export const getReadIdSet = () => loadIdSet(READ_KEY);
export const setReadIdSet = (set) => saveIdSet(READ_KEY, set);
export const getHiddenIdSet = () => loadIdSet(HIDDEN_KEY);
export const setHiddenIdSet = (set) => saveIdSet(HIDDEN_KEY, set);

export const getNotificationId = (notice) => notice?.id || '';

export const getNotificationTimestamp = (notice) => {
  const timestamp = Date.parse(notice?.created_at || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const isNotificationUnread = (notice, lastReadTimestamp, readIds) => {
  const id = getNotificationId(notice);
  if (id && readIds?.has(id)) return false;
  const createdAt = getNotificationTimestamp(notice);
  if (!createdAt) return false;
  return createdAt > (lastReadTimestamp || 0);
};

export const filterHiddenNotifications = (notifications, hiddenIds) => {
  if (!Array.isArray(notifications) || !hiddenIds) return notifications || [];
  return notifications.filter((notice) => {
    const id = getNotificationId(notice);
    if (!id) return true;
    return !hiddenIds.has(id);
  });
};

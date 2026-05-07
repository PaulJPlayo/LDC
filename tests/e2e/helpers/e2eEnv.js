'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED_TARGETS = new Set(['live', 'preview', 'local']);

const loadLocalE2EEnv = () => {
  const envPath = path.join(process.cwd(), '.env.e2e.local');
  const values = {};
  if (!fs.existsSync(envPath)) return values;

  const content = fs.readFileSync(envPath, 'utf8');
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) return;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1);
    if (key) {
      values[key] = value;
    }
  });

  return values;
};

const localE2EEnv = loadLocalE2EEnv();

const readEnv = key => process.env[key] || localE2EEnv[key] || '';

const getTarget = () => {
  const target = (readEnv('E2E_TARGET') || 'live').trim().toLowerCase();
  if (!SUPPORTED_TARGETS.has(target)) {
    throw new Error(`Unsupported E2E_TARGET "${target}". Use live, preview, or local.`);
  }
  return target;
};

const readTargetUrl = (prefix, target) => {
  const key = `${prefix}_${target.toUpperCase()}`;
  const value = readEnv(key).trim();
  if (!value) {
    throw new Error(`Missing ${key}. Configure the ${target} URL before running E2E tests.`);
  }
  return value;
};

const readRequiredEnv = key => {
  const value = readEnv(key);
  if (!value.trim()) {
    throw new Error(`Missing ${key}. Configure it in .env.e2e.local before running E2E tests.`);
  }
  return value;
};

const getE2EEnv = () => {
  const target = getTarget();
  return {
    target,
    publicUrl: readTargetUrl('E2E_PUBLIC_URL', target),
    adminUrl: readTargetUrl('E2E_ADMIN_URL', target),
    publicCredentials: {
      email: readRequiredEnv('E2E_PUBLIC_EMAIL').trim(),
      password: readRequiredEnv('E2E_PUBLIC_PASSWORD')
    },
    adminCredentials: {
      email: readRequiredEnv('E2E_ADMIN_EMAIL').trim(),
      password: readRequiredEnv('E2E_ADMIN_PASSWORD')
    },
    safety: {
      allowRealCheckout: readEnv('E2E_ALLOW_REAL_CHECKOUT') === 'true',
      allowRealPayment: readEnv('E2E_ALLOW_REAL_PAYMENT') === 'true',
      stopBeforeOrderSubmit: readEnv('E2E_STOP_BEFORE_ORDER_SUBMIT') !== 'false'
    }
  };
};

module.exports = {
  getE2EEnv
};

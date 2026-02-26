const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const noop = () => {};

const createStorage = () => {
  const data = new Map();
  return {
    getItem(key) {
      const normalized = String(key);
      return data.has(normalized) ? data.get(normalized) : null;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(String(key));
    }
  };
};

const createElement = () => ({
  style: {
    setProperty: noop,
    removeProperty: noop
  },
  dataset: {},
  classList: {
    add: noop,
    remove: noop,
    toggle: noop,
    contains: () => false
  },
  appendChild: noop,
  removeAttribute: noop,
  setAttribute: noop,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: noop,
  removeEventListener: noop,
  cloneNode: () => createElement(),
  closest: () => null,
  children: [],
  innerHTML: '',
  textContent: '',
  hidden: false
});

const createVmContext = () => {
  const localStorage = createStorage();
  const sessionStorage = createStorage();
  const document = {
    body: {
      dataset: {
        medusaEnabled: 'true',
        medusaBackend: 'https://api.example.test'
      }
    },
    readyState: 'complete',
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    dispatchEvent: noop,
    createElement,
    head: {
      appendChild: noop
    }
  };
  const window = {
    LDC_MEDUSA_ENABLED: true,
    LDC_MEDUSA_BACKEND: 'https://api.example.test',
    location: {
      pathname: '/checkout.html'
    },
    document,
    localStorage,
    sessionStorage,
    setTimeout,
    clearTimeout
  };

  return vm.createContext({
    window,
    document,
    localStorage,
    sessionStorage,
    fetch: async () => ({
      ok: false,
      text: async () => '',
      json: async () => ({})
    }),
    console: {
      info: noop,
      warn: noop,
      error: noop,
      log: noop
    },
    Intl,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout
  });
};

test('checkout canonical formatter converts USD minor units to dollars', () => {
  const commercePath = path.resolve(__dirname, '..', 'commerce.js');
  const commerceSource = fs.readFileSync(commercePath, 'utf8');
  const context = createVmContext();

  vm.runInContext(commerceSource, context, { filename: 'commerce.js' });

  const formatMoneyFromMinor = context.window?.LDCCommerce?.formatMoneyFromMinor;
  assert.equal(typeof formatMoneyFromMinor, 'function');
  assert.equal(formatMoneyFromMinor(1000, 'USD'), '$10.00');
});

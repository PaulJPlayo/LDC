export const STOREFRONT_SECTIONS = [
  { key: 'home-tumblers', label: 'Home · Tumblers', filter: { collection: 'tumblers' } },
  { key: 'home-cups', label: 'Home · Cups & Mugs', filter: { collection: 'cups' } },
  { key: 'home-accessories', label: 'Home · Accessories', filter: { collection: 'accessories' } },
  { key: 'page-tumblers', label: 'Tumblers Page', filter: { collection: 'tumblers' } },
  { key: 'page-cups', label: 'Cups & Mugs Page', filter: { collection: 'cups' } },
  { key: 'page-accessories', label: 'Accessories Page', filter: { collection: 'accessories' } },
  { key: 'page-new-arrivals', label: 'New Arrivals Page', filter: { tag: 'new-arrivals' } },
  { key: 'page-best-sellers', label: 'Best Sellers Page', filter: { tag: 'best-sellers' } },
  { key: 'page-restock', label: 'Restock Page', filter: { tag: 'restock' } },
  { key: 'page-deals', label: 'Deals for the Steal Page', filter: { tag: 'sale' } },
  { key: 'page-under-25', label: 'Under $25 Page', filter: { tag: 'under-25' } },
  { key: 'page-last-chance', label: 'Last Chance Seasonal Page', filter: { tag: 'last-chance' } }
];

export const STOREFRONT_SECTION_MAP = STOREFRONT_SECTIONS.reduce((acc, section) => {
  acc[section.key] = section;
  return acc;
}, {});

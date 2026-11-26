import { createElement } from 'react';
import { CatalogPage } from './CatalogPage';
import { Catalog, catalogs } from './catalogs';
export type { Product, Uom, Warehouse } from './types';

const page = (catalog: Catalog) => function MasterDataPage({ initialId }: { initialId?: number }) {
  return createElement(CatalogPage, { catalog, initialId });
};

export const ProductsPage = page(catalogs.products);
export const TemporaryProductsPage = page(catalogs.temporaryProducts);
export const BrandsPage = page(catalogs.brands);
export const UnitsOfMeasurePage = page(catalogs.unitsOfMeasure);
export const WarehousesPage = page(catalogs.warehouses);
export const CustomersPage = page(catalogs.customers);
export const SuppliersPage = page(catalogs.suppliers);
export const CurrenciesPage = page(catalogs.currencies);
export const TaxRatesPage = page(catalogs.taxRates);

export const DossierTypesPage = page(catalogs.dossierTypes);

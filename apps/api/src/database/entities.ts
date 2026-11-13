import { Permission, Role, User } from '../modules/identity/identity.entities';
import { Product, UnitOfMeasure, Warehouse } from '../modules/master-data/master-data.entities';
import { Inventory, InventoryTransaction } from '../modules/inventory/inventory.entities';

export const ENTITIES = [Permission, Role, User, UnitOfMeasure, Warehouse, Product, Inventory, InventoryTransaction];

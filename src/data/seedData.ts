import { Product, Customer, Supplier, Sale, Purchase } from "@/types/pos";

export const SEED_PRODUCTS: Product[] = [
  { id: "p1", name: "Rice (5kg)", nameUr: "چاول (۵ کلو)", price: 12.99, cost: 9.50, stock: 45, category: "Groceries", lowStockThreshold: 10 },
  { id: "p2", name: "Cooking Oil (1L)", nameUr: "پکانے کا تیل (۱ لیٹر)", price: 4.99, cost: 3.20, stock: 30, category: "Groceries", lowStockThreshold: 8 },
  { id: "p3", name: "Sugar (1kg)", nameUr: "چینی (۱ کلو)", price: 2.49, cost: 1.80, stock: 60, category: "Groceries", lowStockThreshold: 15 },
  { id: "p4", name: "Milk (1L)", nameUr: "دودھ (۱ لیٹر)", price: 1.99, cost: 1.40, stock: 25, category: "Dairy", lowStockThreshold: 10 },
  { id: "p5", name: "Bread", nameUr: "روٹی", price: 1.49, cost: 0.90, stock: 3, category: "Bakery", lowStockThreshold: 5 },
  { id: "p6", name: "Eggs (12pc)", nameUr: "انڈے (۱۲ عدد)", price: 3.99, cost: 2.80, stock: 20, category: "Dairy", lowStockThreshold: 5 },
  { id: "p7", name: "Soap Bar", nameUr: "صابن", price: 0.99, cost: 0.50, stock: 100, category: "Household", lowStockThreshold: 20 },
  { id: "p8", name: "Detergent (500g)", nameUr: "ڈٹرجنٹ (۵۰۰ گرام)", price: 3.49, cost: 2.20, stock: 35, category: "Household", lowStockThreshold: 10 },
];

export const SEED_CUSTOMERS: Customer[] = [
  { id: "c1", name: "John Smith", phone: "555-0101" },
  { id: "c2", name: "Maria Garcia", phone: "555-0102" },
];

export const SEED_SUPPLIERS: Supplier[] = [
  { id: "s1", name: "Metro Wholesale", phone: "555-1001", email: "metro@example.com" },
  { id: "s2", name: "FreshFarm Supplies", phone: "555-1002", email: "fresh@example.com" },
];

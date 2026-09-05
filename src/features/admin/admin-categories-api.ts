import { invokeAdmin, type AdminFunctionGateway } from "./admin-overview-api.ts";

export const ADMIN_CATEGORIES_FUNCTION = "admin-categories";

export type AdminCategory = {
  id: string;
  name: string;
  description: string;
  sort_order: number;
  is_active: boolean;
  product_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CategoryPatch = {
  name?: string;
  description?: string;
  isActive?: boolean;
};

export const MAX_CATEGORY_NAME_LENGTH = 60;
export const MAX_CATEGORY_DESCRIPTION_LENGTH = 280;

type CategoriesResponse = {
  categories: AdminCategory[];
};

type CategoryResponse = {
  category: AdminCategory;
};

type DeleteResponse = {
  categoryId: string;
  clearedProducts: number;
};

export async function loadAdminCategories(
  gateway?: AdminFunctionGateway,
): Promise<AdminCategory[]> {
  const response = await invokeAdmin<CategoriesResponse>(
    { action: "list" },
    ADMIN_CATEGORIES_FUNCTION,
    gateway,
  );
  return response.categories;
}

export async function createAdminCategory(
  name: string,
  description: string,
  gateway?: AdminFunctionGateway,
): Promise<AdminCategory> {
  const response = await invokeAdmin<CategoryResponse>(
    { action: "create", name, description },
    ADMIN_CATEGORIES_FUNCTION,
    gateway,
  );
  return response.category;
}

export async function updateAdminCategory(
  categoryId: string,
  patch: CategoryPatch,
  gateway?: AdminFunctionGateway,
): Promise<AdminCategory> {
  const response = await invokeAdmin<CategoryResponse>(
    { action: "update", categoryId, ...patch },
    ADMIN_CATEGORIES_FUNCTION,
    gateway,
  );
  return response.category;
}

export async function deleteAdminCategory(
  categoryId: string,
  gateway?: AdminFunctionGateway,
): Promise<DeleteResponse> {
  return invokeAdmin<DeleteResponse>(
    { action: "delete", categoryId },
    ADMIN_CATEGORIES_FUNCTION,
    gateway,
  );
}

export function categoryValidationError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Give the category a name.";
  if (trimmed.length > MAX_CATEGORY_NAME_LENGTH) {
    return `Keep the name under ${MAX_CATEGORY_NAME_LENGTH} characters.`;
  }
  return null;
}

export function categoryDescriptionValidationError(description: string): string | null {
  if (description.trim().length > MAX_CATEGORY_DESCRIPTION_LENGTH) {
    return `Keep the description under ${MAX_CATEGORY_DESCRIPTION_LENGTH} characters.`;
  }
  return null;
}

export function findDuplicateCategoryName(
  categories: readonly AdminCategory[],
  name: string,
  excludeId?: string,
): AdminCategory | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  return (
    categories.find(
      (category) => category.id !== excludeId && category.name.trim().toLowerCase() === needle,
    ) ?? null
  );
}

export function filterAdminCategories(
  categories: readonly AdminCategory[],
  searchTerm: string,
): AdminCategory[] {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return [...categories];
  return categories.filter((category) =>
    [category.name, category.description].join(" ").toLowerCase().includes(query),
  );
}

export function sortAdminCategories(categories: readonly AdminCategory[]): AdminCategory[] {
  return [...categories].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.name.localeCompare(b.name);
  });
}

export function replaceAdminCategory(
  categories: readonly AdminCategory[],
  next: AdminCategory,
): AdminCategory[] {
  return sortAdminCategories(
    categories.some((category) => category.id === next.id)
      ? categories.map((category) => (category.id === next.id ? next : category))
      : [...categories, next],
  );
}

export type AdminCategoryStats = {
  total: number;
  active: number;
  hidden: number;
  inUse: number;
};

export function getAdminCategoryStats(categories: readonly AdminCategory[]): AdminCategoryStats {
  const stats: AdminCategoryStats = {
    total: categories.length,
    active: 0,
    hidden: 0,
    inUse: 0,
  };
  for (const category of categories) {
    if (category.is_active) stats.active += 1;
    else stats.hidden += 1;
    if (category.product_count > 0) stats.inUse += 1;
  }
  return stats;
}

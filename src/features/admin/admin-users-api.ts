import {
  invokeAdmin,
  loadAdminOverviewUsers,
  type AdminOverviewUser,
} from "./admin-overview-api.ts";

export { loadAdminOverviewUsers as loadAdminUsers };
export type AdminUser = AdminOverviewUser;

export function filterAdminUsers(users: readonly AdminUser[], searchTerm: string): AdminUser[] {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return [...users];
  return users.filter((user) =>
    [user.id, user.email, user.name].some((value) => value.toLowerCase().includes(query)),
  );
}

export type CreateUserInput = {
  name: string;
  email: string;
  password: string;
  role: string;
};

export type UpdateUserInput = {
  userId: string;
  name: string;
  email: string;
  role: string;
};

type UserResponse = {
  user: AdminUser;
};

export async function createAdminUser(input: CreateUserInput): Promise<void> {
  await invokeAdmin<unknown>({ action: "create", ...input });
}

export async function updateAdminUser(input: UpdateUserInput): Promise<AdminUser> {
  const response = await invokeAdmin<UserResponse>({ action: "update", ...input });
  return response.user;
}

export async function deleteAdminUser(userId: string): Promise<void> {
  await invokeAdmin<unknown>({ action: "delete", userId });
}

import "server-only";

import { UserRole } from "@prisma/client";

import { requireCurrentUser } from "@/services/users/user-service";

export async function requireAdmin() {
  const currentUser = await requireCurrentUser();

  if (currentUser.role !== UserRole.ADMIN) {
    throw new Error("Admin access is required.");
  }

  return currentUser;
}

export async function isCurrentUserAdmin() {
  const currentUser = await requireCurrentUser();

  return currentUser.role === UserRole.ADMIN;
}

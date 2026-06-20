import "server-only";

import { UserRole } from "@prisma/client";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/services/users/user-service";

export async function getCurrentUserRole() {
  const currentUser = await getCurrentUser();

  return currentUser?.role ?? null;
}

export async function isCurrentUserAdmin() {
  const role = await getCurrentUserRole();

  return role === UserRole.ADMIN;
}

export async function requireAdmin() {
  const currentUser = await getCurrentUser();

  if (currentUser?.role !== UserRole.ADMIN) {
    redirect("/app/matters");
  }

  return currentUser;
}

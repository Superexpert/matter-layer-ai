"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/services/auth";
import { grantAdminRole, removeAdminRole } from "@/services/users";

function getRequiredUserId(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();

  if (!userId) {
    throw new Error("User id is required.");
  }

  return userId;
}

export async function grantAdmin(formData: FormData) {
  await requireAdmin();

  await grantAdminRole(getRequiredUserId(formData));
  revalidatePath("/app/settings");
}

export async function removeAdmin(formData: FormData) {
  await requireAdmin();

  try {
    await removeAdminRole(getRequiredUserId(formData));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Matter Layer must have at least one Admin."
    ) {
      redirect("/app/settings?error=last-admin");
    }

    throw error;
  }

  revalidatePath("/app/settings");
}

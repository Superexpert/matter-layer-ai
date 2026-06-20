"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  activateAIProviderConfig,
  AISettingsConfigurationError,
  createAIProviderConfig,
  deleteAIProviderConfig,
} from "@/services/ai/ai-settings-service";
import { requireAdmin } from "@/services/auth";

function redirectForAISettingsError(error: unknown): never {
  if (error instanceof AISettingsConfigurationError) {
    redirect(`/app/admin?error=${encodeURIComponent(error.message)}`);
  }

  throw error;
}

export async function createProviderConfig(formData: FormData) {
  await requireAdmin();

  try {
    await createAIProviderConfig(formData);
  } catch (error) {
    redirectForAISettingsError(error);
  }

  revalidatePath("/app/admin");
  redirect("/app/admin?saved=ai");
}

export async function activateProviderConfig(formData: FormData) {
  await requireAdmin();

  try {
    await activateAIProviderConfig(formData);
  } catch (error) {
    redirectForAISettingsError(error);
  }

  revalidatePath("/app/admin");
  redirect("/app/admin?saved=ai");
}

export async function deleteProviderConfig(formData: FormData) {
  await requireAdmin();

  try {
    await deleteAIProviderConfig(formData);
  } catch (error) {
    redirectForAISettingsError(error);
  }

  revalidatePath("/app/admin");
  redirect("/app/admin?saved=ai");
}

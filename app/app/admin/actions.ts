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
import {
  saveWorkflowStepSetting,
  WorkflowStepSettingError,
} from "@/services/workflows/workflow-step-settings-service";

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

export async function saveWorkflowStepSettingAction(formData: FormData) {
  await requireAdmin();

  const workflowId = String(formData.get("workflowId") ?? "").trim();
  const stepId = String(formData.get("stepId") ?? "").trim();
  const settingKey = String(formData.get("settingKey") ?? "").trim();
  const rawValue = formData.get("settingValue");

  if (!workflowId || !stepId || !settingKey) {
    redirect("/app/admin?tab=workflows");
  }

  try {
    await saveWorkflowStepSetting({
      rawValue,
      settingKey,
      stepId,
      workflowId,
    });
  } catch (error) {
    if (error instanceof WorkflowStepSettingError) {
      redirect(
        `/app/admin/workflows/${workflowId}?error=${encodeURIComponent(error.message)}`,
      );
    }

    throw error;
  }

  revalidatePath(`/app/admin/workflows/${workflowId}`);
  redirect(`/app/admin/workflows/${workflowId}?saved=${stepId}:${settingKey}`);
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  ApplicationResetError,
  resetMatterLayerApplication,
  RESET_APPLICATION_CONFIRMATION_PHRASE,
} from "@/services/admin/application-reset-service";
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

export type ResetApplicationActionState = {
  message: string;
  status: "idle" | "success" | "error";
};

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

export async function resetApplicationAction(
  _previousState: ResetApplicationActionState,
  formData: FormData,
): Promise<ResetApplicationActionState> {
  const confirmationPhrase = String(
    formData.get("confirmationPhrase") ?? "",
  );

  try {
    await resetMatterLayerApplication({
      confirmationPhrase,
    });
  } catch (error) {
    if (error instanceof ApplicationResetError) {
      return {
        message: error.message,
        status: "error",
      };
    }

    console.error("Reset Application failed.", {
      errorName: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    return {
      message: "Reset Application failed. No success state was recorded.",
      status: "error",
    };
  }

  revalidatePath("/app/admin");
  revalidatePath("/app/matters");

  return {
    message: `Application reset complete. Sample matters have been recreated. Type ${RESET_APPLICATION_CONFIRMATION_PHRASE} again before running another reset.`,
    status: "success",
  };
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { requireAppSetup } from "@/services/setup";

export async function createMatter(formData: FormData) {
  await requireAppSetup();

  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  const name = String(formData.get("name") ?? "").trim();

  if (!name) {
    throw new Error("Matter name is required.");
  }

  const { prisma } = await import("@/lib/prisma");

  await prisma.matter.create({
    data: {
      name,
    },
  });

  revalidatePath("/app/matters");
}

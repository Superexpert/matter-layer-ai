import { connection } from "next/server";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { requireAppSetup } from "@/services/setup";

export default async function Home() {
  await connection();

  await requireAppSetup();

  const session = await auth();

  if (!session) {
    redirect("/login");
  }

  redirect("/app/matters");
}

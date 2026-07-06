import Link from "next/link";

import { requireConfiguredAISettings } from "@/services/ai/ai-settings-service";
import { seedDefaultSampleMattersIfNoMattersExist } from "@/services/matters/sample-matters-service";
import { requireCurrentUser } from "@/services/users/user-service";

import { NewMatterForm } from "./NewMatterForm";

export default async function MattersPage() {
  await requireConfiguredAISettings();
  const currentUser = await requireCurrentUser();
  await seedDefaultSampleMattersIfNoMattersExist({
    uploadedByUserId: currentUser.id,
  });

  const { prisma } = await import("@/lib/prisma");

  const matters = await prisma.matter.findMany({
    orderBy: {
      createdAt: "desc",
    },
  });

  return (
    <section>
      <h1 className="text-3xl font-semibold text-zinc-950">Matters</h1>
      <NewMatterForm />
      <div className="mt-8">
        {matters.length > 0 ? (
          <ul className="grid gap-3" data-testid="matters-list">
            {matters.map((matter) => (
              <li
                className="bg-white text-sm font-medium text-zinc-950 shadow-sm ring-1 ring-zinc-200 transition-colors hover:bg-zinc-50"
                key={matter.id}
              >
                <Link
                  className="block p-4"
                  data-testid="matter-link"
                  href={`/app/matters/${matter.id}`}
                >
                  {matter.name}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p
            className="text-sm leading-6 text-zinc-700"
            data-testid="matters-list"
          >
            No matters yet.
          </p>
        )}
      </div>
    </section>
  );
}

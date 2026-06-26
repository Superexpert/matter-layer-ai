import Link from "next/link";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";

type WorkflowEditPlaceholderPageProps = {
  params: Promise<{
    workflowId: string;
  }>;
};

export default async function WorkflowEditPlaceholderPage({
  params,
}: WorkflowEditPlaceholderPageProps) {
  const { workflowId } = await params;
  const workflow = await prisma.workflow.findUnique({
    select: {
      name: true,
    },
    where: {
      slug: workflowId,
    },
  });

  if (!workflow) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-3xl rounded-xl border border-[#E3DEEA] bg-white p-6 shadow-[0_1px_2px_rgba(40,29,52,0.05)]">
      <p className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-[#74677F]">
        Workflow editor
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-[#211B27]">
        {workflow.name}
      </h1>
      <p className="mt-3 text-sm leading-6 text-[#74677F]">
        Workflow editing will be completed here.
      </p>
      <Link
        className="mt-5 inline-flex h-9 items-center justify-center rounded-lg bg-[#5F4B76] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4B3861]"
        href="/app/matters"
      >
        Back to matters
      </Link>
    </main>
  );
}

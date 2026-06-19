import { notFound } from "next/navigation";

import { MatterChat } from "./MatterChat";

type MatterPageProps = {
  params: Promise<{
    matterId: string;
  }>;
};

export default async function MatterPage({ params }: MatterPageProps) {
  const { matterId } = await params;
  const { prisma } = await import("@/lib/prisma");

  const matter = await prisma.matter.findUnique({
    where: {
      id: matterId,
    },
    select: {
      name: true,
    },
  });

  if (!matter) {
    notFound();
  }

  return <MatterChat matterId={matterId} matterName={matter.name} />;
}

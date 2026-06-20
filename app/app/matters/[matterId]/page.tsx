import { notFound } from "next/navigation";

import { requireConfiguredAISettings } from "@/services/ai/ai-settings-service";
import { isCurrentUserAdmin } from "@/services/auth";

import { MatterChat } from "./MatterChat";

type MatterPageProps = {
  params: Promise<{
    matterId: string;
  }>;
};

export default async function MatterPage({ params }: MatterPageProps) {
  const { matterId } = await params;
  await requireConfiguredAISettings();

  const [{ prisma }, isAdmin] = await Promise.all([
    import("@/lib/prisma"),
    isCurrentUserAdmin(),
  ]);

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

  return (
    <MatterChat
      isAdmin={isAdmin}
      matterId={matterId}
      matterName={matter.name}
    />
  );
}

import { prisma } from "@/lib/prisma";
import { syncBuiltInWorkflows } from "@/services/workflows/catalog-service";

async function main() {
  const syncedWorkflows = await syncBuiltInWorkflows();

  console.log(`Synced ${syncedWorkflows.length} built-in workflow(s).`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

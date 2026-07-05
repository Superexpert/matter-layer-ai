import { PrismaClient, WorkflowSource } from "@prisma/client";
import { expect, test } from "@playwright/test";

import {
  createCustomWorkflow,
  deleteCustomWorkflow,
  duplicateWorkflow,
  exportWorkflowForBuiltIn,
  listEnabledWorkflowCatalog,
  listEnabledWorkflowDefinitions,
  syncBuiltInWorkflows,
} from "../../services/workflows/catalog-service";
import { generateWorkflowDraftFromGoal } from "../../services/workflows/workflow-builder-service";

const prisma = new PrismaClient();

test.afterAll(async () => {
  await prisma.$disconnect();
});

test("built-in workflow sync upserts built-in workflows into the database", async () => {
  test.skip(!process.env.DATABASE_URL, "Requires DATABASE_URL.");

  await syncBuiltInWorkflows();

  const workflowBuilder = await prisma.workflow.findUniqueOrThrow({
    where: {
      slug: "workflow-builder",
    },
  });

  expect(workflowBuilder.source).toBe(WorkflowSource.builtIn);
  expect(workflowBuilder.isSystem).toBe(true);
  expect(workflowBuilder.isEnabled).toBe(true);
  expect(workflowBuilder.builtInVersion).toBe(1);

  const workflowDefinitions = await listEnabledWorkflowDefinitions();

  expect(workflowDefinitions.some((workflow) => workflow.id === "workflow-builder")).toBe(
    true,
  );

  const workflowCatalog = await listEnabledWorkflowCatalog();
  const workflowBuilderCatalogItem = workflowCatalog.find(
    (workflow) => workflow.id === "workflow-builder",
  );

  expect(workflowBuilderCatalogItem?.isBuiltIn).toBe(true);
  expect(workflowBuilderCatalogItem?.source).toBe("builtIn");

  const eminentDomainWorkflow = await prisma.workflow.findUniqueOrThrow({
    where: {
      slug: "eminent-domain-case-assessment",
    },
  });

  expect(eminentDomainWorkflow.source).toBe(WorkflowSource.builtIn);
  expect(eminentDomainWorkflow.isSystem).toBe(false);
  expect(eminentDomainWorkflow.isEnabled).toBe(true);
  expect(eminentDomainWorkflow.builtInVersion).toBe(1);

  expect(
    workflowDefinitions.some(
      (workflow) =>
        workflow.id === "eminent-domain-case-assessment" &&
        workflow.name === "Eminent Domain Case Assessment" &&
        workflow.steps.length === 2 &&
        workflow.steps[0]?.type === "fileSelector" &&
        workflow.steps[1]?.type === "extraction" &&
        workflow.steps[1]?.name === "Analyze Case Documents",
    ),
  ).toBe(true);

  const eminentDomainCatalogItem = workflowCatalog.find(
    (workflow) => workflow.id === "eminent-domain-case-assessment",
  );

  expect(eminentDomainCatalogItem).toMatchObject({
    description:
      "Assess an eminent domain matter by starting with the relevant case documents.",
    isBuiltIn: true,
    name: "Eminent Domain Case Assessment",
    source: "builtIn",
  });
});

test("custom workflows are saved with unique slugs and can be exported", async () => {
  test.skip(!process.env.DATABASE_URL, "Requires DATABASE_URL.");

  const uniqueName = `Catalog Persistence Test ${Date.now()}`;
  const draftWorkflow = {
    ...generateWorkflowDraftFromGoal("Create a chronology from selected matter documents"),
    name: uniqueName,
  };
  const savedWorkflow = await createCustomWorkflow(draftWorkflow, null);
  const savedAgainWorkflow = await createCustomWorkflow(draftWorkflow, null);

  try {
    expect(savedWorkflow.id).toContain("catalog-persistence-test");
    expect(savedAgainWorkflow.id).toContain("catalog-persistence-test");
    expect(savedAgainWorkflow.id).not.toBe(savedWorkflow.id);

    const workflowRows = await prisma.workflow.findMany({
      where: {
        slug: {
          in: [savedWorkflow.id, savedAgainWorkflow.id],
        },
      },
    });

    expect(workflowRows).toHaveLength(2);
    expect(workflowRows.every((workflow) => workflow.source === WorkflowSource.custom)).toBe(
      true,
    );

    const workflowExport = JSON.parse(
      await exportWorkflowForBuiltIn(savedWorkflow.id),
    ) as {
      definition: {
        name: string;
      };
      slug: string;
    };

    expect(workflowExport.slug).toBe(savedWorkflow.id);
    expect(workflowExport.definition.name).toBe(uniqueName);
  } finally {
    await prisma.workflow.deleteMany({
      where: {
        slug: {
          in: [savedWorkflow.id, savedAgainWorkflow.id],
        },
      },
    });
  }
});

test("built-in workflows cannot be deleted", async () => {
  test.skip(!process.env.DATABASE_URL, "Requires DATABASE_URL.");

  await syncBuiltInWorkflows();

  await expect(deleteCustomWorkflow("workflow-builder")).rejects.toThrow(
    "Built-in workflows cannot be deleted.",
  );

  await expect(
    prisma.workflow.findUnique({
      where: {
        slug: "workflow-builder",
      },
    }),
  ).resolves.toMatchObject({
    source: WorkflowSource.builtIn,
  });
});

test("duplicating a workflow creates a custom copy that can be deleted", async () => {
  test.skip(!process.env.DATABASE_URL, "Requires DATABASE_URL.");

  await syncBuiltInWorkflows();
  const duplicatedWorkflow = await duplicateWorkflow("workflow-builder", null);

  try {
    expect(duplicatedWorkflow.name).toBe("Copy of Workflow Builder");
    expect(duplicatedWorkflow.isBuiltIn).toBe(false);
    expect(duplicatedWorkflow.source).toBe("custom");

    const duplicatedWorkflowRow = await prisma.workflow.findUniqueOrThrow({
      where: {
        slug: duplicatedWorkflow.id,
      },
    });

    expect(duplicatedWorkflowRow.source).toBe(WorkflowSource.custom);
    expect(duplicatedWorkflowRow.builtInVersion).toBeNull();

    await deleteCustomWorkflow(duplicatedWorkflow.id);

    await expect(
      prisma.workflow.findUnique({
        where: {
          slug: duplicatedWorkflow.id,
        },
      }),
    ).resolves.toBeNull();
  } finally {
    await prisma.workflow.deleteMany({
      where: {
        slug: duplicatedWorkflow.id,
      },
    });
  }
});

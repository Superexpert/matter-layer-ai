# MatterLayer Workflows

Built-in workflows live in this root `workflows` folder and are synced into the
database at runtime or with:

```bash
npm run sync:workflows
```

The database is the runtime source of truth for the workflow catalog. Built-in
sync updates rows with `source = builtIn` and never overwrites a custom workflow
that uses the same slug.

Promotion path for a custom workflow:

1. Create and save the custom workflow in MatterLayer.
2. Export the workflow with `exportWorkflowForBuiltIn(slug)`.
3. Add a new `*.workflow.ts` file under this folder using the exported
   definition and built-in metadata.
4. Export the metadata from `workflows/index.ts`.
5. Commit, deploy, and run built-in workflow sync.

## Project status

Matter Layer is in active v1 development. Do not preserve backwards
compatibility unless explicitly asked; prefer simple, direct changes that can
fail fast when something is wrong.

## Database workflow

Use `prisma db push` for database schema changes. Do not create Prisma
migrations unless explicitly asked.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

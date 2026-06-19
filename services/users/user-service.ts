import "server-only";

import { Prisma, UserRole } from "@prisma/client";
import type { Session } from "next-auth";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const FIRST_ADMIN_BOOTSTRAP_RETRIES = 3;
const ADMIN_ROLE_CHANGE_RETRIES = 3;

function getSessionEmail(session: Session | null) {
  const email = session?.user?.email?.trim().toLowerCase();

  if (!email) {
    throw new Error("Authenticated session is missing an email address.");
  }

  return email;
}

async function runFirstAdminBootstrapTransaction(session: Session) {
  const email = getSessionEmail(session);

  return prisma.$transaction(
    async (tx) => {
      const adminCount = await tx.user.count({
        where: {
          role: UserRole.ADMIN,
        },
      });
      const role = adminCount === 0 ? UserRole.ADMIN : UserRole.USER;

      return tx.user.upsert({
        create: {
          email,
          image: session.user?.image,
          name: session.user?.name,
          role,
        },
        update: {
          image: session.user?.image,
          name: session.user?.name,
          role: adminCount === 0 ? UserRole.ADMIN : undefined,
        },
        where: {
          email,
        },
      });
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    },
  );
}

function isSerializableTransactionConflict(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

export async function ensureUserForSession(session: Session) {
  for (let attempt = 1; attempt <= FIRST_ADMIN_BOOTSTRAP_RETRIES; attempt += 1) {
    try {
      return await runFirstAdminBootstrapTransaction(session);
    } catch (error) {
      if (
        attempt === FIRST_ADMIN_BOOTSTRAP_RETRIES ||
        !isSerializableTransactionConflict(error)
      ) {
        throw error;
      }
    }
  }

  throw new Error("Could not bootstrap current user.");
}

export async function getCurrentUser() {
  const session = await auth();

  if (!session?.user) {
    return null;
  }

  return ensureUserForSession(session);
}

export async function requireCurrentUser() {
  const currentUser = await getCurrentUser();

  if (!currentUser) {
    throw new Error("Authentication is required.");
  }

  return currentUser;
}

export async function listUsers() {
  return prisma.user.findMany({
    orderBy: [
      {
        role: "asc",
      },
      {
        createdAt: "asc",
      },
    ],
  });
}

export async function getAdminCount() {
  return prisma.user.count({
    where: {
      role: UserRole.ADMIN,
    },
  });
}

export async function grantAdminRole(userId: string) {
  return prisma.user.update({
    data: {
      role: UserRole.ADMIN,
    },
    where: {
      id: userId,
    },
  });
}

export async function removeAdminRole(userId: string) {
  for (let attempt = 1; attempt <= ADMIN_ROLE_CHANGE_RETRIES; attempt += 1) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const adminCount = await tx.user.count({
            where: {
              role: UserRole.ADMIN,
            },
          });

          if (adminCount <= 1) {
            throw new Error("Matter Layer must have at least one Admin.");
          }

          return tx.user.update({
            data: {
              role: UserRole.USER,
            },
            where: {
              id: userId,
              role: UserRole.ADMIN,
            },
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
    } catch (error) {
      if (
        attempt === ADMIN_ROLE_CHANGE_RETRIES ||
        !isSerializableTransactionConflict(error)
      ) {
        throw error;
      }
    }
  }

  throw new Error("Could not update Admin role.");
}

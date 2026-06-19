import { UserRole } from "@prisma/client";

import { getCurrentUser, getAdminCount, listUsers } from "@/services/users";
import { grantAdmin, removeAdmin } from "./actions";

type SettingsPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const [{ error }, currentUser] = await Promise.all([
    searchParams,
    getCurrentUser(),
  ]);

  if (!currentUser || currentUser.role !== UserRole.ADMIN) {
    return (
      <section className="max-w-3xl">
        <h1 className="text-3xl font-semibold text-zinc-950">Settings</h1>
        <div
          className="mt-6 border-l-4 border-[#b24a3b] bg-[#fff4f0] p-5"
          data-testid="settings-unauthorized"
        >
          <h2 className="text-lg font-semibold text-zinc-950">
            Admin access required
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-700">
            You do not have permission to manage Matter Layer settings. Ask an
            Admin to grant you access.
          </p>
        </div>
      </section>
    );
  }

  const [users, adminCount] = await Promise.all([listUsers(), getAdminCount()]);
  const showFirstAdminNote =
    currentUser.role === UserRole.ADMIN && adminCount === 1 && users.length === 1;

  return (
    <section>
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold text-zinc-950">Settings</h1>
        <p className="max-w-3xl text-sm leading-6 text-zinc-700">
          Manage Matter Layer application settings and Admin access. Google
          OAuth is used for identity only; Matter Layer roles are stored in the
          local database.
        </p>
      </div>

      {showFirstAdminNote ? (
        <div className="mt-6 border-l-4 border-[#5c6f47] bg-[#f4f8ef] p-5">
          <h2 className="text-lg font-semibold text-zinc-950">
            First Admin created
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-700">
            You are the first Matter Layer user, so you were made an Admin.
          </p>
        </div>
      ) : null}

      {error === "last-admin" ? (
        <div
          className="mt-6 border-l-4 border-[#b24a3b] bg-[#fff4f0] p-5"
          data-testid="settings-error"
          role="alert"
        >
          <h2 className="text-lg font-semibold text-zinc-950">
            Role change blocked
          </h2>
          <p className="mt-2 text-sm leading-6 text-zinc-700">
            Matter Layer must have at least one Admin.
          </p>
        </div>
      ) : null}

      <section className="mt-8 bg-white p-6 shadow-sm ring-1 ring-zinc-200">
        <h2 className="text-2xl font-semibold text-zinc-950">Users</h2>
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-zinc-600">
                <th className="py-3 pr-4 font-semibold">User</th>
                <th className="py-3 pr-4 font-semibold">Role</th>
                <th className="py-3 pr-4 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody data-testid="admin-users-list">
              {users.map((user) => {
                const isAdmin = user.role === UserRole.ADMIN;
                const isFinalAdmin = isAdmin && adminCount <= 1;

                return (
                  <tr className="border-b border-zinc-100" key={user.id}>
                    <td className="py-4 pr-4">
                      <div className="font-medium text-zinc-950">
                        {user.name || user.email}
                      </div>
                      <div className="mt-1 text-zinc-600">{user.email}</div>
                    </td>
                    <td className="py-4 pr-4">
                      <span
                        className="inline-flex border border-zinc-300 bg-zinc-50 px-2 py-1 font-mono text-xs text-zinc-800"
                        data-testid="user-role"
                      >
                        {user.role}
                      </span>
                    </td>
                    <td className="py-4 pr-4">
                      {isAdmin ? (
                        <form action={removeAdmin}>
                          <input name="userId" type="hidden" value={user.id} />
                          <button
                            className="inline-flex h-10 items-center justify-center border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-100 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-500"
                            data-testid="remove-admin-button"
                            disabled={isFinalAdmin}
                            type="submit"
                          >
                            Remove Admin
                          </button>
                        </form>
                      ) : (
                        <form action={grantAdmin}>
                          <input name="userId" type="hidden" value={user.id} />
                          <button
                            className="inline-flex h-10 items-center justify-center bg-[#263326] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#344734]"
                            data-testid="grant-admin-button"
                            type="submit"
                          >
                            Make Admin
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}

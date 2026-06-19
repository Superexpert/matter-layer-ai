"use client";

import { useState } from "react";

import { createMatter } from "./actions";

export function NewMatterForm() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-6">
      <button
        className="inline-flex h-11 items-center justify-center bg-[#263326] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#344734]"
        data-testid="new-matter-button"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        New Matter
      </button>

      {isOpen ? (
        <form
          action={createMatter}
          className="mt-4 grid max-w-xl gap-4 bg-white p-5 shadow-sm ring-1 ring-zinc-200"
          data-testid="new-matter-form"
        >
          <label className="grid gap-2 text-sm font-medium text-zinc-800">
            Matter name
            <input
              className="h-11 border border-zinc-300 px-3 text-base font-normal text-zinc-950 outline-none focus:border-[#5c6f47]"
              data-testid="matter-name-input"
              name="name"
              required
              type="text"
            />
          </label>
          <div className="flex flex-wrap gap-3">
            <button
              className="inline-flex h-10 items-center justify-center bg-[#263326] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#344734]"
              data-testid="create-matter-submit"
              type="submit"
            >
              Create Matter
            </button>
            <button
              className="inline-flex h-10 items-center justify-center border border-zinc-300 bg-white px-4 text-sm font-semibold text-zinc-950 transition-colors hover:bg-zinc-100"
              onClick={() => setIsOpen(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

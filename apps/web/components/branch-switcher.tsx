"use client";

import { useState } from "react";

export interface BranchOption {
  id: string;
  name: string;
}

export function BranchSwitcher({
  branches,
  activeBranchId,
  onSwitch,
  disabled = false
}: {
  branches: BranchOption[];
  activeBranchId: string;
  onSwitch: (branchId: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const active = branches.find((branch) => branch.id === activeBranchId) ?? branches[0];
  const others = branches.filter((branch) => branch.id !== activeBranchId);

  return (
    <div className="branch-switcher">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        disabled={disabled || branches.length <= 1}
      >
        {active?.name ?? "Seleccionar sucursal"}
      </button>
      {open ? (
        <ul role="listbox" aria-label="Sucursales" className="branch-switcher-menu">
          {others.map((branch) => (
            <li key={branch.id} role="option" aria-selected={branch.id === activeBranchId}>
              <button
                type="button"
                onClick={() => {
                  onSwitch(branch.id);
                  setOpen(false);
                }}
              >
                {branch.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

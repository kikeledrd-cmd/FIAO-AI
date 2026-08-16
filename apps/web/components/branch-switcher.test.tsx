import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BranchSwitcher, type BranchOption } from "./branch-switcher";

const branches: BranchOption[] = [
  { id: "los-mina", name: "Los Mina" },
  { id: "invivienda", name: "Invivienda" }
];

describe("BranchSwitcher", () => {
  it("shows the active branch and changes context only after selection", async () => {
    const user = userEvent.setup();
    const mockSetBranch = vi.fn();

    render(<BranchSwitcher branches={branches} activeBranchId="los-mina" onSwitch={mockSetBranch} />);

    expect(screen.getByText("Los Mina")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /Los Mina/ }));
    await user.click(screen.getByText("Invivienda"));

    expect(mockSetBranch).toHaveBeenCalledWith("invivienda");
  });

  it("does not call onSwitch when opening the menu without selecting", async () => {
    const user = userEvent.setup();
    const mockSetBranch = vi.fn();

    render(<BranchSwitcher branches={branches} activeBranchId="los-mina" onSwitch={mockSetBranch} />);

    await user.click(screen.getByRole("button", { name: /Los Mina/ }));
    expect(mockSetBranch).not.toHaveBeenCalled();
  });

  it("disables the trigger for a single branch", () => {
    const mockSetBranch = vi.fn();
    render(
      <BranchSwitcher
        branches={[{ id: "los-mina", name: "Los Mina" }]}
        activeBranchId="los-mina"
        onSwitch={mockSetBranch}
      />
    );

    expect(screen.getByRole("button", { name: /Los Mina/ })).toBeDisabled();
  });
});

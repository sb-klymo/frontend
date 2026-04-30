import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaymentModeToggle } from "./PaymentModeToggle";

describe("PaymentModeToggle", () => {
  it("renders the binary toggle in the on state", () => {
    render(<PaymentModeToggle value={true} onChange={() => {}} />);
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeChecked();
  });

  it("renders unchecked when value is false", () => {
    render(<PaymentModeToggle value={false} onChange={() => {}} />);
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("calls onChange with the next value when clicked", () => {
    const onChange = vi.fn();
    render(<PaymentModeToggle value={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("disables the checkbox when disabled prop is set", () => {
    render(<PaymentModeToggle value={true} onChange={() => {}} disabled />);
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });
});

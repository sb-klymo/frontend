import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import HomePage from "./page";

describe("HomePage", () => {
  it("renders the brand heading", () => {
    render(<HomePage />);
    expect(screen.getByRole("heading", { name: "Klymo" })).toBeInTheDocument();
  });
});

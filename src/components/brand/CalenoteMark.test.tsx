import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CalenoteMark } from "./CalenoteMark";

describe("CalenoteMark", () => {
  it("renders the canonical horizontal brand asset", () => {
    render(<CalenoteMark />);

    expect(screen.getByRole("img", { name: "Calenote" })).toHaveAttribute(
      "src",
      "/brand/calenote-logo-horizontal.svg",
    );
  });

  it("uses the canonical mark for compact placements", () => {
    render(<CalenoteMark compact />);

    expect(screen.getByRole("img", { name: "Calenote" })).toHaveAttribute(
      "src",
      "/brand/calenote-mark.svg",
    );
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginForm } from "@/components/auth/login-form";
import { authenticate } from "@/lib/actions/auth";

// The real action reaches next-auth and the database. The form's own contract
// is the ActionState it renders back, so the action is replaced wholesale —
// the same approach tests/integration/vitest-setup.ts takes with @/auth.
vi.mock("@/lib/actions/auth", () => ({
  authenticate: vi.fn(async () => ({
    success: false,
    errors: {},
    message: "",
  })),
}));

beforeEach(() => {
  vi.mocked(authenticate).mockClear();
});

describe("LoginForm", () => {
  it("renders labelled username and password fields", () => {
    render(<LoginForm redirectTo="/dashboard" />);

    expect(screen.getByLabelText("Username")).toBeRequired();
    const password = screen.getByLabelText("Password");
    expect(password).toBeRequired();
    expect(password).toHaveAttribute("type", "password");
  });

  it("carries the redirect target through as a hidden field", () => {
    const { container } = render(<LoginForm redirectTo="/dashboard/accounts" />);
    expect(container.querySelector('input[name="redirectTo"]')).toHaveValue(
      "/dashboard/accounts"
    );
  });

  it("shows no error region before a submission", () => {
    render(<LoginForm redirectTo="/dashboard" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("submits the entered credentials to the action", async () => {
    const user = userEvent.setup();
    render(<LoginForm redirectTo="/dashboard" />);

    await user.type(screen.getByLabelText("Username"), "ada");
    await user.type(screen.getByLabelText("Password"), "hunter2");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(authenticate).toHaveBeenCalledTimes(1);
    const formData = vi.mocked(authenticate).mock.calls[0][1] as FormData;
    expect(formData.get("username")).toBe("ada");
    expect(formData.get("password")).toBe("hunter2");
    expect(formData.get("redirectTo")).toBe("/dashboard");
  });

  it("announces the action's failure message as an alert", async () => {
    vi.mocked(authenticate).mockResolvedValueOnce({
      success: false,
      errors: {},
      message: "Invalid username or password",
    });
    const user = userEvent.setup();
    render(<LoginForm redirectTo="/dashboard" />);

    // Both fields are `required`, so an empty submit is blocked by constraint
    // validation and never reaches the action at all.
    await user.type(screen.getByLabelText("Username"), "ada");
    await user.type(screen.getByLabelText("Password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid username or password"
    );
  });
});

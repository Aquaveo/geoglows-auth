import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProfileCompletionBanner } from "../../src/react/ProfileCompletionBanner";
import type { Profile } from "../../src/types";

afterEach(() => {
  cleanup();
});

describe("<ProfileCompletionBanner>", () => {
  it("renders nothing when the profile is complete", () => {
    const profile: Profile = {
      id: "u",
      email: "u@x.com",
      display_name: "Ada Lovelace",
      first_name: "Ada",
      last_name: "Lovelace",
    };
    const { container } = render(<ProfileCompletionBanner profile={profile} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when profile is null", () => {
    const { container } = render(<ProfileCompletionBanner profile={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the banner with default copy when the profile is incomplete", () => {
    const profile: Profile = {
      id: "u",
      email: "u@x.com",
      display_name: null,
    };
    render(<ProfileCompletionBanner profile={profile} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/profile is missing/i);
    expect(screen.getByRole("button", { name: /complete profile/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /dismiss/i })).toBeInTheDocument();
  });

  it("fires onComplete when the CTA is clicked", () => {
    const profile: Profile = { id: "u", email: "u@x.com", display_name: null };
    const onComplete = vi.fn();
    render(<ProfileCompletionBanner profile={profile} onComplete={onComplete} />);
    fireEvent.click(screen.getByRole("button", { name: /complete profile/i }));
    expect(onComplete).toHaveBeenCalled();
  });

  it("fires onDismiss when Dismiss is clicked", () => {
    const profile: Profile = { id: "u", email: "u@x.com", display_name: null };
    const onDismiss = vi.fn();
    render(<ProfileCompletionBanner profile={profile} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("hides the dismiss button when dismissible is false", () => {
    const profile: Profile = { id: "u", email: "u@x.com", display_name: null };
    render(
      <ProfileCompletionBanner profile={profile} dismissible={false} />,
    );
    expect(screen.queryByRole("button", { name: /dismiss/i })).toBeNull();
    expect(screen.getByRole("button", { name: /complete profile/i })).toBeInTheDocument();
  });

  it("respects custom message and ctaLabel props", () => {
    const profile: Profile = { id: "u", email: "u@x.com", display_name: null };
    render(
      <ProfileCompletionBanner
        profile={profile}
        message="Tell us your name."
        ctaLabel="Add my name"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/tell us your name/i);
    expect(screen.getByRole("button", { name: /add my name/i })).toBeInTheDocument();
  });

  it("considers a profile with whitespace-only first/last as incomplete", () => {
    const profile: Profile = {
      id: "u",
      email: "u@x.com",
      display_name: null,
      first_name: "  ",
      last_name: "  ",
    };
    render(<ProfileCompletionBanner profile={profile} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

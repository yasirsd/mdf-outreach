import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Modal } from "./Modal";
import { Drawer } from "./Drawer";

afterEach(() => cleanup());

describe("Modal — busy prop", () => {
  it("normal modal closes on backdrop click", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        content
      </Modal>,
    );
    const backdrop = document.querySelector('[data-mdf-backdrop-busy], .backdrop-blur-\\[3px\\]');
    // Backdrop is the first div under the dialog wrapper.
    const dlgBackdrop = document
      .querySelector('[role="dialog"]')
      ?.querySelector("div.absolute");
    expect(dlgBackdrop).toBeTruthy();
    fireEvent.click(dlgBackdrop as Element);
    expect(onClose).toHaveBeenCalledTimes(1);
    void backdrop;
  });

  it("busy modal does NOT close on backdrop click", () => {
    const onClose = vi.fn();
    render(
      <Modal open busy onClose={onClose}>
        content
      </Modal>,
    );
    const dlgBackdrop = document
      .querySelector('[role="dialog"]')
      ?.querySelector("div.absolute");
    fireEvent.click(dlgBackdrop as Element);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("busy modal does NOT close on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal open busy onClose={onClose}>
        content
      </Modal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("normal modal closes on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose}>
        content
      </Modal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("busy modal disables the header X close button", () => {
    render(
      <Modal open busy onClose={vi.fn()}>
        content
      </Modal>,
    );
    const closeBtn = screen.getByLabelText("Close");
    expect(closeBtn.hasAttribute("disabled")).toBe(true);
  });
});

describe("Drawer — busy prop", () => {
  it("busy drawer does NOT close on backdrop click or Escape", () => {
    const onClose = vi.fn();
    render(
      <Drawer open busy onClose={onClose}>
        content
      </Drawer>,
    );
    // Find the backdrop
    const backdrop = document.querySelector(".backdrop-blur-\\[2px\\]");
    fireEvent.click(backdrop as Element);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

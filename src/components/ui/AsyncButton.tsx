"use client";

import { forwardRef, useCallback, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * MDF Outreach — canonical async button.
 *
 * Wraps a mutation function and:
 *   • ignores repeat clicks while pending (aria-busy + disabled)
 *   • shows an inline spinner and an optional "pendingLabel"
 *   • preserves button width so text swaps don't jump layout
 *   • never swallows the underlying error — throws / rejects reach the
 *     caller so toasts / error boundaries can react
 *   • supports variant (primary / secondary / ghost / danger) mapping to
 *     the existing globals.css classes
 *
 * Not a replacement for every `<button>`. Use it wherever pending state
 * during a server action would otherwise be invisible.
 */

export type AsyncButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface AsyncButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onClick"> {
  onClick?: (
    e: React.MouseEvent<HTMLButtonElement>,
  ) => void | Promise<void> | unknown | Promise<unknown>;
  variant?: AsyncButtonVariant;
  /** Extra text shown while pending. Defaults to children with "…". */
  pendingLabel?: React.ReactNode;
  /**
   * When true, an external caller controls pending (e.g. a controlled
   * useTransition). Skip the internal state machine.
   */
  pending?: boolean;
  /** Icon rendered before the label in idle state. */
  icon?: React.ReactNode;
  /**
   * Called with the rejection when an UNCONTROLLED `onClick` promise
   * rejects. Provides an explicit, testable hook for user-facing
   * error messaging (typically a toast). If omitted the rejection is
   * logged to `console.warn` and the button returns to idle.
   *
   * Controlled callers (`pending` supplied) are expected to handle
   * failures in their own try/catch and this prop is not invoked.
   */
  onError?: (error: unknown) => void;
}

const VARIANT_CLASS: Record<AsyncButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  danger: "btn-danger",
};

export const AsyncButton = forwardRef<HTMLButtonElement, AsyncButtonProps>(
  function AsyncButton(
    {
      onClick,
      variant = "primary",
      pendingLabel,
      pending: pendingProp,
      icon,
      onError,
      children,
      className,
      disabled,
      type = "button",
      ...rest
    },
    ref,
  ) {
    const [internalPending, setInternalPending] = useState(false);
    const isPending = pendingProp ?? internalPending;
    const busy = isPending || !!disabled;
    // Guard against a runaway "onClick returned a promise that never
    // resolved" case by snapshotting the promise; still lets the caller
    // control failure.
    const inFlightRef = useRef<Promise<unknown> | null>(null);

    const handleClick = useCallback(
      async (e: React.MouseEvent<HTMLButtonElement>) => {
        if (isPending || disabled) {
          e.preventDefault();
          return;
        }
        if (!onClick) return;
        const result = onClick(e);
        if (
          result &&
          typeof result === "object" &&
          "then" in (result as PromiseLike<unknown>)
        ) {
          const promise = result as Promise<unknown>;
          if (pendingProp === undefined) {
            inFlightRef.current = promise;
            setInternalPending(true);
            try {
              await promise;
            } catch (err) {
              // Explicit contract: an onError handler receives the
              // rejection for user-facing feedback (toast, banner,
              // etc.). If none is provided we still surface to the
              // console so dev tools + Vercel runtime logs see it —
              // callers that omit onError AND do not toast in their
              // onClick body will not silently fail (they leave a
              // visible warning in production logs).
              if (onError) {
                onError(err);
              } else {
                console.warn(
                  "[AsyncButton] onClick rejected without an onError handler; the failure is invisible to the operator. Provide onError, or handle the rejection inside onClick with a toast.",
                  err,
                );
              }
            } finally {
              if (inFlightRef.current === promise) {
                setInternalPending(false);
                inFlightRef.current = null;
              }
            }
          }
        }
      },
      [onClick, isPending, disabled, pendingProp, onError],
    );

    return (
      <button
        ref={ref}
        type={type}
        onClick={handleClick}
        disabled={busy}
        aria-busy={isPending || undefined}
        aria-disabled={busy || undefined}
        data-pending={isPending || undefined}
        className={cn(VARIANT_CLASS[variant], className)}
        {...rest}
      >
        {isPending ? (
          <>
            <Loader2 size={13} className="animate-spin" aria-hidden />
            <span>{pendingLabel ?? children}</span>
          </>
        ) : (
          <>
            {icon ? <span aria-hidden>{icon}</span> : null}
            <span>{children}</span>
          </>
        )}
      </button>
    );
  },
);

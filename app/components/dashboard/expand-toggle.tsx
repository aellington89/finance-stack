"use client";

import type { MouseEvent, ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExpandToggleProps {
  expanded: boolean;
  onToggle: () => void;
  /** The row's label, which is also the button's accessible name. */
  children: ReactNode;
  className?: string;
  chevronClassName?: string;
}

/**
 * The disclosure button for an expandable table row (Issue #144).
 *
 * The rows toggled on a click of the <tr> alone, which a keyboard cannot reach
 * and a screen reader cannot report. A real <button> in the row's first cell
 * fixes both without any key handling of our own: Tab reaches it, Enter and
 * Space activate it, and aria-expanded is announced as collapsed or expanded.
 * That is the disclosure pattern, chosen over an ARIA treegrid, which would
 * need roving focus, aria-level/posinset/setsize on every row and somewhere
 * to put the footer Total rows — for screen-reader support that is patchier
 * than a plain button's.
 *
 * The row keeps its own onClick, so a click anywhere on it still toggles. That
 * is why this stops propagation: a click on the button would otherwise reach
 * the row as well and toggle twice, which looks like nothing happening.
 *
 * No aria-controls. The child rows are unmounted while collapsed, so there is
 * no element for it to point at, and few screen readers act on it anyway.
 */
export function ExpandToggle({
  expanded,
  onToggle,
  children,
  className,
  chevronClassName,
}: ExpandToggleProps) {
  const Chevron = expanded ? ChevronDown : ChevronRight;

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggle();
  };

  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={handleClick}
      className={cn(
        // -mx-1 px-1 widens the box, and so the focus ring, without moving
        // the label: a ring drawn flush against the chevron reads as cramped.
        "-mx-1 inline-flex cursor-pointer items-center gap-1 rounded-sm px-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className
      )}
    >
      <Chevron className={cn("size-4 shrink-0", chevronClassName)} />
      {children}
    </button>
  );
}

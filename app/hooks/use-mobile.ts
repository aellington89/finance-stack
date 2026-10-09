import * as React from "react"

/**
 * DIVERGES FROM UPSTREAM SHADCN (#193) — `npx shadcn add sidebar` brings this
 * file back as the registry's effect-based original, which lint rejects
 * (react-hooks/set-state-in-effect). Keep this version.
 *
 * The viewport is an external store, so it is read with useSyncExternalStore
 * rather than copied into state from an effect. The media query only signals
 * that the breakpoint was crossed; the width is the value.
 */
const MOBILE_BREAKPOINT = 768
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onStoreChange: () => void) {
  const mql = window.matchMedia(MOBILE_QUERY)
  mql.addEventListener("change", onStoreChange)
  return () => mql.removeEventListener("change", onStoreChange)
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

// The server cannot see the viewport, so its HTML takes the desktop branch.
// Hydration renders with this same value and React then re-renders with the
// real one, so the sidebar never hydrates against mismatched markup. A
// client-only mount skips straight to the real value.
function getServerSnapshot() {
  return false
}

export function useIsMobile() {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

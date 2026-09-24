import type { CSSProperties } from "react"
import type { ChartConfig } from "@/components/ui/chart"

/**
 * The `--color-*` custom properties each chart's marks reference, as a plain
 * style object. Custom properties inherit, so setting them on the container
 * reaches every recharts element inside its SVG — which is all the injected
 * `<style>` element was ever achieving.
 *
 * Nothing in a production build reads these through `var()`: all nine
 * dashboard charts hand colours straight to recharts as `fill`/`stroke` props,
 * and the one page that does resolve them — `app/(app)/test-ui/page.tsx` —
 * calls notFound() outside development. They are emitted anyway because the
 * contract is shadcn's rather than this app's, and a chart added later will
 * expect them. That also means a regression here is invisible on the dashboard,
 * which is why e2e/csp.spec.ts reads one back out of getComputedStyle.
 *
 * The key filter is the security half of this change. `expenses-category-chart`
 * builds config keys from **database category names**, and upstream drops them
 * unescaped into a `<style>` body — where a `}` closes the rule and whatever
 * follows becomes new selectors and declarations. A style attribute is a much
 * smaller surface (React escapes the value, and the blast radius is one div's
 * declarations), but a name that is not a valid CSS identifier produces a dead
 * declaration either way, so there is nothing to lose by refusing it outright.
 */
export function chartColorVars(config: ChartConfig): CSSProperties {
  return Object.fromEntries(
    Object.entries(config)
      .filter(([key, item]) => item.color && /^[\w-]+$/.test(key))
      .map(([key, item]) => [`--color-${key}`, item.color])
  ) as CSSProperties
}

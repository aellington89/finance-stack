"use client"

import * as React from "react"
import * as RechartsPrimitive from "recharts"

import { cn } from "@/lib/utils"

/**
 * DIVERGES FROM UPSTREAM SHADCN (#237) — `npx shadcn add chart` will clobber
 * this file and reintroduce what was removed. Read this before accepting it.
 *
 * Upstream lets an entry carry either a single `color` or a
 * `theme: { light, dark }` pair, and renders a `<style>` element via
 * dangerouslySetInnerHTML to emit both as `--color-*` declarations under `:root`
 * and `.dark`. That was the only dangerouslySetInnerHTML in the app, and the
 * only reason `script-src`'s sibling directive needed watching.
 *
 * The `theme` variant is gone rather than merely unused. No config in this app
 * ever set one — all ten pass a single `color`, which made the `.dark` half of
 * the generated CSS a byte-identical duplicate of the light half — and the
 * replacement mechanism, a `style` attribute on the container, cannot express
 * two theme scopes at all. Keeping the type would mean accepting a per-theme
 * colour at compile time and silently dropping half of it at runtime, so the
 * compiler rejects it instead.
 *
 * If per-theme chart colours are ever genuinely wanted, the shape to reach for
 * is a pair of variables resolved by the existing `@custom-variant dark`
 * selector in globals.css — not a return to the injected stylesheet.
 */
export type ChartConfig = {
  [k in string]: {
    label?: React.ReactNode
    icon?: React.ComponentType
    color?: string
  }
}

type ChartContextProps = {
  config: ChartConfig
}

const ChartContext = React.createContext<ChartContextProps | null>(null)

function useChart() {
  const context = React.useContext(ChartContext)

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />")
  }

  return context
}

function ChartContainer({
  id,
  className,
  children,
  config,
  style,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig
  children: React.ComponentProps<
    typeof RechartsPrimitive.ResponsiveContainer
  >["children"]
}) {
  const uniqueId = React.useId()
  const chartId = `chart-${id || uniqueId.replace(/:/g, "")}`

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector]:outline-hidden [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-surface]:outline-hidden",
          className
        )}
        style={{ ...chartColorVars(config), ...style }}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

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
function chartColorVars(config: ChartConfig): React.CSSProperties {
  return Object.fromEntries(
    Object.entries(config)
      .filter(([key, item]) => item.color && /^[\w-]+$/.test(key))
      .map(([key, item]) => [`--color-${key}`, item.color])
  ) as React.CSSProperties
}

const ChartTooltip = RechartsPrimitive.Tooltip

// Narrow view of the tooltip payload for `labelFormatter` callbacks that only
// read the underlying row's `date`. Readonly is the load-bearing part: recharts
// 3 hands `labelFormatter` a `ReadonlyArray`, and a parameter typed as a
// mutable array is not assignable to that. A readonly parameter still accepts
// recharts 2's mutable array, so this types the same callbacks under both.
export type TooltipDatePayload = ReadonlyArray<{
  payload?: { date?: string }
}>

// These props were previously read off `React.ComponentProps<typeof Tooltip>`.
// recharts 3 moves `active`/`payload`/`label` out of `TooltipProps` — the chart
// now holds them in its own store and injects them into whatever `content`
// renders — so that type no longer describes this component's inputs.
//
// `DefaultTooltipContent` is the component recharts renders when no `content`
// is given, which is exactly this component's contract, and unlike recharts 3's
// `TooltipContentProps` it is exported by both 2.x and 3.x. `active` is declared
// here because it belongs to the tooltip wrapper rather than the content props
// in both majors. Everything stays optional: recharts fills these in when it
// clones the element passed to `content`, so nothing is set at the call site.
type ChartTooltipContentProps = React.ComponentProps<"div"> &
  Pick<
    React.ComponentProps<typeof RechartsPrimitive.DefaultTooltipContent>,
    "payload" | "label" | "labelFormatter" | "formatter"
  > & {
    active?: boolean
    hideLabel?: boolean
    hideIndicator?: boolean
    indicator?: "line" | "dot" | "dashed"
    nameKey?: string
    labelKey?: string
    labelClassName?: string
  }

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = "dot",
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  labelClassName,
  formatter,
  color,
  nameKey,
  labelKey,
}: ChartTooltipContentProps) {
  const { config } = useChart()

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) {
      return null
    }

    const [item] = payload
    const key = `${labelKey || item?.dataKey || item?.name || "value"}`
    const itemConfig = getPayloadConfigFromPayload(config, item, key)
    const value =
      !labelKey && typeof label === "string"
        ? config[label as keyof typeof config]?.label || label
        : itemConfig?.label

    if (labelFormatter) {
      return (
        <div className={cn("font-medium", labelClassName)}>
          {labelFormatter(value, payload)}
        </div>
      )
    }

    if (!value) {
      return null
    }

    return <div className={cn("font-medium", labelClassName)}>{value}</div>
  }, [
    label,
    labelFormatter,
    payload,
    hideLabel,
    labelClassName,
    config,
    labelKey,
  ])

  if (!active || !payload?.length) {
    return null
  }

  const nestLabel = payload.length === 1 && indicator !== "dot"

  return (
    <div
      className={cn(
        "grid min-w-32 items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl",
        className
      )}
    >
      {!nestLabel ? tooltipLabel : null}
      <div className="grid gap-1.5">
        {payload
          .filter((item) => item.type !== "none")
          .map((item, index) => {
            const key = `${nameKey || item.name || item.dataKey || "value"}`
            const itemConfig = getPayloadConfigFromPayload(config, item, key)
            const indicatorColor = color || item.payload.fill || item.color

            return (
              <div
                key={typeof item.dataKey === "function" ? key : item.dataKey}
                className={cn(
                  "flex w-full flex-wrap items-stretch gap-2 [&>svg]:h-2.5 [&>svg]:w-2.5 [&>svg]:text-muted-foreground",
                  indicator === "dot" && "items-center"
                )}
              >
                {formatter && item?.value !== undefined && item.name ? (
                  formatter(item.value, item.name, item, index, item.payload)
                ) : (
                  <>
                    {itemConfig?.icon ? (
                      <itemConfig.icon />
                    ) : (
                      !hideIndicator && (
                        <div
                          className={cn(
                            "shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)",
                            {
                              "h-2.5 w-2.5": indicator === "dot",
                              "w-1": indicator === "line",
                              "w-0 border-[1.5px] border-dashed bg-transparent":
                                indicator === "dashed",
                              "my-0.5": nestLabel && indicator === "dashed",
                            }
                          )}
                          style={
                            {
                              "--color-bg": indicatorColor,
                              "--color-border": indicatorColor,
                            } as React.CSSProperties
                          }
                        />
                      )
                    )}
                    <div
                      className={cn(
                        "flex flex-1 justify-between leading-none",
                        nestLabel ? "items-end" : "items-center"
                      )}
                    >
                      <div className="grid gap-1.5">
                        {nestLabel ? tooltipLabel : null}
                        <span className="text-muted-foreground">
                          {itemConfig?.label || item.name}
                        </span>
                      </div>
                      {item.value && (
                        <span className="font-mono font-medium text-foreground tabular-nums">
                          {item.value.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </>
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}

const ChartLegend = RechartsPrimitive.Legend

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  verticalAlign = "bottom",
  nameKey,
}: React.ComponentProps<"div"> &
  // Same story as the tooltip: recharts 3 omits `payload` and `verticalAlign`
  // from `LegendProps` and injects them into the legend's `content`, so the
  // types have to come from the default content component instead.
  Pick<
    RechartsPrimitive.DefaultLegendContentProps,
    "payload" | "verticalAlign"
  > & {
    hideIcon?: boolean
    nameKey?: string
  }) {
  const { config } = useChart()

  if (!payload?.length) {
    return null
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-4",
        verticalAlign === "top" ? "pb-3" : "pt-3",
        className
      )}
    >
      {payload
        .filter((item) => item.type !== "none")
        .map((item) => {
          const key = `${nameKey || item.dataKey || "value"}`
          const itemConfig = getPayloadConfigFromPayload(config, item, key)

          return (
            <div
              key={item.value}
              className={cn(
                "flex items-center gap-1.5 [&>svg]:h-3 [&>svg]:w-3 [&>svg]:text-muted-foreground"
              )}
            >
              {itemConfig?.icon && !hideIcon ? (
                <itemConfig.icon />
              ) : (
                <div
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{
                    backgroundColor: item.color,
                  }}
                />
              )}
              {itemConfig?.label}
            </div>
          )
        })}
    </div>
  )
}

function getPayloadConfigFromPayload(
  config: ChartConfig,
  payload: unknown,
  key: string
) {
  if (typeof payload !== "object" || payload === null) {
    return undefined
  }

  const payloadPayload =
    "payload" in payload &&
    typeof payload.payload === "object" &&
    payload.payload !== null
      ? payload.payload
      : undefined

  let configLabelKey: string = key

  if (
    key in payload &&
    typeof payload[key as keyof typeof payload] === "string"
  ) {
    configLabelKey = payload[key as keyof typeof payload] as string
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === "string"
  ) {
    configLabelKey = payloadPayload[
      key as keyof typeof payloadPayload
    ] as string
  }

  return configLabelKey in config
    ? config[configLabelKey]
    : config[key as keyof typeof config]
}

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
}

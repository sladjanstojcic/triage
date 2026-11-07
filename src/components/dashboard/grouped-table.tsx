"use client";

import { ChevronRightIcon } from "lucide-react";
import { createContext, Fragment, use } from "react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { Empty } from "./cells";

/** Collapsed group keys for every table on the page, so the toolbar can expand/collapse all. */
export const CollapseContext = createContext<{ collapsed: Set<string>; toggle: (key: string) => void }>({
  collapsed: new Set(),
  toggle: () => {},
});

export type Column = {
  header: React.ReactNode;
  /** tailwind width for a fixed column, e.g. "w-24"; omit for the flexible column */
  width?: string;
  align?: "right";
};

export type GroupRow = { key: string; cells: React.ReactNode[]; className?: string };

export type TableGroup = {
  key: string;
  title: React.ReactNode;
  /** right side of the group header: counts, group actions */
  meta?: React.ReactNode;
  className?: string;
  rows: GroupRow[];
};

/** Collapse keys are namespaced per table so tabs don't share state. */
export const groupKey = (scope: string, key: string) => `${scope}:${key}`;

/**
 * The one table layout used across the dashboard: a header row per group (click to collapse)
 * with its items as indented subrows. `flat` drops the group header rows, for a table that
 * already shows a single group (e.g. one subtab).
 */
export function GroupedTable({
  scope,
  columns,
  groups,
  empty,
  flat = false,
}: {
  scope: string;
  columns: Column[];
  groups: TableGroup[];
  empty: React.ReactNode;
  flat?: boolean;
}) {
  const { collapsed, toggle } = use(CollapseContext);
  if (groups.every((g) => flat && g.rows.length === 0) || groups.length === 0) return <Empty>{empty}</Empty>;
  const indent = (i: number) => i === 0 && !flat && "pl-9";

  const align = (c: Column) => cn(c.width, c.align === "right" && "text-right");

  return (
    <Card size="sm" className="py-0">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow>
            {columns.map((c, i) => (
              <TableHead key={i} className={cn(align(c), indent(i))}>
                {c.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g) => {
            const key = groupKey(scope, g.key);
            const open = flat || !collapsed.has(key);
            return (
              <Fragment key={g.key}>
                {!flat && (
                <TableRow
                  className={cn("cursor-pointer bg-muted/40 hover:bg-muted/60", g.className)}
                  onClick={(e) => {
                    // ignore clicks on controls in the header, and on dialogs portalled out of it
                    const target = e.target as HTMLElement;
                    if (!e.currentTarget.contains(target) || target.closest("button, a, input")) return;
                    toggle(key);
                  }}
                >
                  <TableCell colSpan={columns.length} className="py-2 whitespace-normal">
                    <div className="flex min-w-0 items-center gap-2">
                      <ChevronRightIcon
                        className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
                      />
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{g.title}</div>
                      {g.meta && <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{g.meta}</div>}
                    </div>
                  </TableCell>
                </TableRow>
                )}
                {open &&
                  g.rows.map((r) => (
                    <TableRow key={r.key} className={r.className}>
                      {r.cells.map((cell, i) => (
                        <TableCell key={i} className={cn("align-top whitespace-normal", align(columns[i]), indent(i))}>
                          {cell}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}

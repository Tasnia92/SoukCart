import { useMemo, useState, type ReactNode } from "react";
import { ArrowUpDown, Columns3, EllipsisVertical, ListFilter, Package, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RouterLink } from "../../components/ui/RouterLink.tsx";
import { EmptyState, TableShell } from "../../components/ui/Workspace.tsx";
import { formatDate, formatPrice } from "../workspace/format.ts";
import {
  OrderCustomerCell,
  OrderProductCell,
  ORDER_STATUS_TABS,
  StatusBadge,
  shortId,
  type OrderStatusTab,
} from "./order-presentation.tsx";

export type OrderTableRow = {
  id: string;
  productName: string;
  productImageUrl?: string | null;
  extraItemCount?: number;
  customerName: string;
  customerEmail?: string | null;
  type: "sale" | "refund";
  price: number;
  date: string;
  status: string;
};

export type OrderMenuItem = {
  label: string;
  onSelect?: () => void;
  to?: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
  destructive?: boolean;
  disabled?: boolean;
};

const COLUMN_IDS = ["order", "product", "customer", "type", "price", "date", "status"] as const;
type ColumnId = (typeof COLUMN_IDS)[number];

const COLUMN_LABELS: Record<ColumnId, string> = {
  order: "Order",
  product: "Product",
  customer: "Retailer",
  type: "Type",
  price: "Price",
  date: "Date",
  status: "Status",
};

const SORTABLE = new Set<ColumnId>(["order", "product", "price", "date", "status"]);

type SortState = { id: ColumnId; dir: "asc" | "desc" };

const TAB_LABELS: Record<OrderStatusTab, string> = {
  all: "All",
  pending: "Pending",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export function OrderRowMenu({ items }: { items: OrderMenuItem[] }) {
  if (!items.length) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Order actions"
          onClick={(event) => event.stopPropagation()}
        >
          <EllipsisVertical />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
        <DropdownMenuGroup>
          {items.map((item) =>
            item.to ? (
              <DropdownMenuItem key={item.label} asChild disabled={item.disabled}>
                <RouterLink to={item.to} params={item.params} search={item.search}>
                  {item.label}
                </RouterLink>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                key={item.label}
                variant={item.destructive ? "destructive" : "default"}
                disabled={item.disabled}
                onSelect={item.onSelect}
              >
                {item.label}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function sortRows(rows: OrderTableRow[], sort: SortState): OrderTableRow[] {
  const next = [...rows];
  next.sort((left, right) => {
    let cmp = 0;
    switch (sort.id) {
      case "order":
        cmp = left.id.localeCompare(right.id);
        break;
      case "product":
        cmp = left.productName.localeCompare(right.productName);
        break;
      case "price":
        cmp = left.price - right.price;
        break;
      case "date":
        cmp = left.date.localeCompare(right.date);
        break;
      case "status":
        cmp = left.status.localeCompare(right.status);
        break;
      default:
        cmp = 0;
    }
    return sort.dir === "asc" ? cmp : -cmp;
  });
  return next;
}

export function OrdersDataTable({
  rows,
  tab,
  onTabChange,
  counts,
  search,
  onSearchChange,
  extraFilters,
  activeFilterCount = 0,
  showCustomer = true,
  showColumns = true,
  onRowOpen,
  rowMenuItems,
  onExportSelected,
  emptyTitle = "No orders",
  emptyCopy = "Orders will show up here.",
  emptyAction,
}: {
  rows: OrderTableRow[];
  tab: OrderStatusTab;
  onTabChange: (tab: OrderStatusTab) => void;
  counts: Record<OrderStatusTab, number>;
  search: string;
  onSearchChange: (value: string) => void;
  extraFilters?: ReactNode;
  activeFilterCount?: number;
  showCustomer?: boolean;
  showColumns?: boolean;
  onRowOpen: (id: string) => void;
  rowMenuItems: (row: OrderTableRow) => OrderMenuItem[];
  onExportSelected?: (ids: string[]) => void;
  emptyTitle?: string;
  emptyCopy?: string;
  emptyAction?: ReactNode;
}) {
  const [sort, setSort] = useState<SortState>({ id: "date", dir: "desc" });
  const [hidden, setHidden] = useState<Partial<Record<ColumnId, boolean>>>({});
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());

  const visibleColumns = useMemo(
    () =>
      COLUMN_IDS.filter((id) => {
        if (id === "customer" && !showCustomer) return false;
        return hidden[id] !== true;
      }),
    [hidden, showCustomer],
  );

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const visibleIds = useMemo(() => sorted.map((row) => row.id), [sorted]);
  const selectedVisible = visibleIds.filter((id) => selected.has(id));
  const allSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
  const someSelected = selectedVisible.length > 0 && !allSelected;

  const toggleSort = (id: ColumnId) => {
    setSort((previous) =>
      previous.id === id
        ? { id, dir: previous.dir === "asc" ? "desc" : "asc" }
        : { id, dir: id === "date" || id === "price" ? "desc" : "asc" },
    );
  };

  const toggleHidden = (id: ColumnId, next: boolean) => {
    setHidden((previous) => ({ ...previous, [id]: !next }));
  };

  const toggleAll = (checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) {
        for (const id of visibleIds) next.add(id);
      } else {
        for (const id of visibleIds) next.delete(id);
      }
      return next;
    });
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const filterCount = activeFilterCount + (search.trim() ? 1 : 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Tabs value={tab} onValueChange={(value) => onTabChange(value as OrderStatusTab)}>
          <TabsList className="flex-wrap">
            {ORDER_STATUS_TABS.map((id) => (
              <TabsTrigger key={id} value={id}>
                {TAB_LABELS[id]}
                <span className="text-muted-foreground">{counts[id]}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-2">
          {selectedVisible.length && onExportSelected ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onExportSelected(selectedVisible)}
            >
              Export {selectedVisible.length}
            </Button>
          ) : null}
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="sm">
                <ListFilter data-icon="inline-start" />
                Filters
                {filterCount ? <Badge variant="secondary">{filterCount}</Badge> : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              <PopoverHeader>
                <PopoverTitle>Filters</PopoverTitle>
                <PopoverDescription>Search and narrow the list.</PopoverDescription>
              </PopoverHeader>
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="orders-search">Search</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon>
                      <Search />
                    </InputGroupAddon>
                    <InputGroupInput
                      id="orders-search"
                      type="search"
                      value={search}
                      placeholder="Order, product, name…"
                      onChange={(event) => onSearchChange(event.target.value)}
                    />
                  </InputGroup>
                </Field>
                {extraFilters}
              </FieldGroup>
            </PopoverContent>
          </Popover>
          {showColumns ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  <Columns3 data-icon="inline-start" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  {COLUMN_IDS.filter((id) => id !== "customer" || showCustomer).map((id) => (
                    <DropdownMenuCheckboxItem
                      key={id}
                      checked={hidden[id] !== true}
                      onCheckedChange={(checked) => toggleHidden(id, checked === true)}
                    >
                      {COLUMN_LABELS[id]}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      {sorted.length ? (
        <TableShell>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all orders"
                    checked={allSelected ? true : someSelected ? "indeterminate" : false}
                    onCheckedChange={(checked) => toggleAll(checked === true)}
                  />
                </TableHead>
                {visibleColumns.map((id) => (
                  <TableHead key={id}>
                    {SORTABLE.has(id) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="-ml-2"
                        onClick={() => toggleSort(id)}
                      >
                        {COLUMN_LABELS[id]}
                        <ArrowUpDown data-icon="inline-end" />
                      </Button>
                    ) : (
                      COLUMN_LABELS[id]
                    )}
                  </TableHead>
                ))}
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((row) => (
                <TableRow
                  key={row.id}
                  id={`order-${row.id}`}
                  data-state={selected.has(row.id) ? "selected" : undefined}
                  className="cursor-pointer"
                  onClick={() => onRowOpen(row.id)}
                >
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      aria-label={`Select order #${shortId(row.id)}`}
                      checked={selected.has(row.id)}
                      onCheckedChange={(checked) => toggleOne(row.id, checked === true)}
                    />
                  </TableCell>
                  {visibleColumns.map((id) => (
                    <TableCell key={id}>
                      {id === "order" ? (
                        <span className="font-medium">#{shortId(row.id)}</span>
                      ) : null}
                      {id === "product" ? (
                        <OrderProductCell
                          name={row.productName}
                          imageUrl={row.productImageUrl}
                          extraCount={row.extraItemCount}
                        />
                      ) : null}
                      {id === "customer" ? (
                        <OrderCustomerCell name={row.customerName} email={row.customerEmail} />
                      ) : null}
                      {id === "type" ? (
                        <span className="text-sm">{row.type === "refund" ? "Refund" : "Sale"}</span>
                      ) : null}
                      {id === "price" ? (
                        <span className="tabular-nums">{formatPrice(row.price)}</span>
                      ) : null}
                      {id === "date" ? formatDate(row.date) : null}
                      {id === "status" ? <StatusBadge status={row.status} /> : null}
                    </TableCell>
                  ))}
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <OrderRowMenu items={rowMenuItems(row)} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableShell>
      ) : (
        <EmptyState icon={Package} title={emptyTitle} copy={emptyCopy} action={emptyAction} />
      )}
    </div>
  );
}

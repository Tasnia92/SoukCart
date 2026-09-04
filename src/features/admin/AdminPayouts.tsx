import { useEffect, useState, type FormEvent } from "react";
import { HandCoins, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  StatCard,
  StatGrid,
  TableShell,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { shortId } from "../orders/order-presentation.tsx";
import { formatDate, formatPercent, formatPrice } from "../workspace/format.ts";
import { AdminWorkspaceShell } from "./admin-workspace-shell.tsx";
import {
  loadAdminPayouts,
  markSellerPaid,
  percentFromRate,
  rateFromPercent,
  setCommissionRate,
  type AdminPayoutOverview,
  type AdminPayoutRow,
  type AdminPayoutSeller,
} from "./admin-payouts-api.ts";

type AdminPayoutsProps = {
  loadPayouts?: () => Promise<AdminPayoutOverview>;
  saveRate?: (rate: number) => Promise<number>;
  paySeller?: (sellerId: string) => Promise<{ paidTotal: number }>;
};

type Notice = { message: string; state: NoticeState } | null;

function payoutStatusLabel(status: AdminPayoutRow["status"]): string {
  if (status === "paid") return "Paid";
  if (status === "reversed") return "Reversed";
  return "Available";
}

function SellerRow({
  seller,
  busy,
  onPay,
}: {
  seller: AdminPayoutSeller;
  busy: boolean;
  onPay: (seller: AdminPayoutSeller) => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex min-w-48 flex-col gap-1">
          <strong className="font-medium">{seller.sellerName}</strong>
          <small className="truncate text-xs text-muted-foreground">{seller.sellerEmail}</small>
        </div>
      </TableCell>
      <TableCell className="tabular-nums">{formatPrice(seller.available)}</TableCell>
      <TableCell className="tabular-nums">{formatPrice(seller.paid)}</TableCell>
      <TableCell>{seller.lastPaidAt ? formatDate(seller.lastPaidAt) : "—"}</TableCell>
      <TableCell className="text-right">
        {seller.available > 0 ? (
          <Button type="button" size="sm" disabled={busy} onClick={() => onPay(seller)}>
            Mark paid
          </Button>
        ) : (
          <span className="text-muted-foreground">Settled</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function LedgerRow({ row }: { row: AdminPayoutRow }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{row.sellerName}</TableCell>
      <TableCell>#{shortId(row.orderId)}</TableCell>
      <TableCell className="tabular-nums">{formatPrice(row.gross)}</TableCell>
      <TableCell className="tabular-nums">{formatPercent(row.commissionRate)}</TableCell>
      <TableCell className="tabular-nums">{formatPrice(row.commissionAmount)}</TableCell>
      <TableCell className="tabular-nums">{formatPrice(row.netPayable)}</TableCell>
      <TableCell>
        <Badge variant={row.status === "available" ? "outline" : "secondary"}>
          {payoutStatusLabel(row.status)}
        </Badge>
      </TableCell>
      <TableCell>{formatDate(row.accruedAt)}</TableCell>
    </TableRow>
  );
}

export function AdminPayouts({
  loadPayouts = loadAdminPayouts,
  saveRate = setCommissionRate,
  paySeller = markSellerPaid,
}: AdminPayoutsProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const [overview, setOverview] = useState<AdminPayoutOverview | null>(null);
  const [rateInput, setRateInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [savingRate, setSavingRate] = useState(false);
  const [busySellerId, setBusySellerId] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setError(null);

    void loadPayouts()
      .then((next) => {
        if (!current) return;
        setOverview(next);
        setRateInput(percentFromRate(next.commissionRate));
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [loadPayouts, loadVersion]);

  if (state.status !== "admin") return null;

  const onLogout = () => {
    void store.signOut();
  };
  const retry = () => setLoadVersion((version) => version + 1);
  const userName = state.profile.name || "Administrator";

  if (error) {
    return (
      <WorkspaceError
        eyebrow="Admin workspace"
        title="We could not load payouts."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const onSaveRate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const rate = rateFromPercent(rateInput);
    if (rate === null) {
      setNotice({
        message: "Enter a commission rate of 0% or more, and less than 100%.",
        state: "error",
      });
      return;
    }

    setSavingRate(true);
    void saveRate(rate)
      .then((applied) => {
        setOverview((prev) => (prev ? { ...prev, commissionRate: applied } : prev));
        setRateInput(percentFromRate(applied));
        setNotice({
          message: `Commission is now ${formatPercent(applied)}. New deliveries use this rate.`,
          state: "success",
        });
      })
      .catch((saveError: unknown) => {
        setNotice({
          message:
            saveError instanceof Error
              ? saveError.message
              : "The commission rate could not be saved.",
          state: "error",
        });
      })
      .finally(() => setSavingRate(false));
  };

  const onPay = (seller: AdminPayoutSeller) => {
    setBusySellerId(seller.sellerId);
    void paySeller(seller.sellerId)
      .then((result) => {
        setNotice({
          message: `Marked ${formatPrice(result.paidTotal)} as paid to ${seller.sellerName}.`,
          state: "success",
        });
        setLoadVersion((version) => version + 1);
      })
      .catch((payError: unknown) => {
        setNotice({
          message:
            payError instanceof Error ? payError.message : "The payout could not be recorded.",
          state: "error",
        });
      })
      .finally(() => setBusySellerId(null));
  };

  return (
    <AdminWorkspaceShell
      activePath="/admin/payouts"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Finance"
        title="Commission and payouts."
        copy="Set the platform cut, then settle sellers weekly after SoukCart has collected payment (including COD) and withheld commission."
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {overview ? (
        <div className="flex flex-col gap-6">
          <StatGrid label="Payout summary">
            <StatCard label="Commission rate" value={formatPercent(overview.commissionRate)} />
            <StatCard label="Commission earned" value={formatPrice(overview.commissionEarned)} />
            <StatCard label="Pending payouts" value={formatPrice(overview.pendingPayout)} />
            <StatCard label="Paid to suppliers" value={formatPrice(overview.paidOut)} />
          </StatGrid>

          <Card>
            <form onSubmit={onSaveRate}>
              <CardHeader>
                <CardTitle>Platform commission</CardTitle>
                <CardDescription>
                  One rate for every product. Changing it does not rewrite past payouts.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="commission-rate">Commission rate (%)</FieldLabel>
                    <Input
                      id="commission-rate"
                      name="commissionRate"
                      type="number"
                      min="0"
                      max="99.99"
                      step="0.01"
                      value={rateInput}
                      onChange={(event) => setRateInput(event.target.value)}
                      required
                    />
                    <FieldDescription>
                      Applied when an order is delivered and paid. Default is 5%.
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </CardContent>
              <CardFooter>
                <Button type="submit" disabled={savingRate}>
                  Save rate
                </Button>
              </CardFooter>
            </form>
          </Card>

          <section className="flex flex-col gap-3" aria-labelledby="seller-balances-heading">
            <h2 id="seller-balances-heading" className="text-lg font-semibold">
              Supplier balances
            </h2>
            {overview.sellers.length ? (
              <TableShell>
                <Table className="min-w-4xl">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Available</TableHead>
                      <TableHead>Already paid</TableHead>
                      <TableHead>Last paid</TableHead>
                      <TableHead>
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.sellers.map((seller) => (
                      <SellerRow
                        key={seller.sellerId}
                        seller={seller}
                        busy={busySellerId === seller.sellerId}
                        onPay={onPay}
                      />
                    ))}
                  </TableBody>
                </Table>
              </TableShell>
            ) : (
              <EmptyState
                icon={HandCoins}
                title="No supplier earnings yet"
                copy="Payouts appear here after a delivered, paid order."
              />
            )}
          </section>

          <section className="flex flex-col gap-3" aria-labelledby="payout-ledger-heading">
            <h2 id="payout-ledger-heading" className="text-lg font-semibold">
              Recent ledger
            </h2>
            {overview.recent.length ? (
              <TableShell>
                <Table className="min-w-5xl">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Order</TableHead>
                      <TableHead>Gross</TableHead>
                      <TableHead>Rate</TableHead>
                      <TableHead>Commission</TableHead>
                      <TableHead>Net</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Accrued</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.recent.map((row) => (
                      <LedgerRow key={row.id} row={row} />
                    ))}
                  </TableBody>
                </Table>
              </TableShell>
            ) : (
              <EmptyState
                icon={Search}
                title="No payout rows"
                copy="Delivered and paid orders create a ledger line for each supplier."
              />
            )}
          </section>
        </div>
      ) : (
        <LoadingState title="Loading payouts…" />
      )}
    </AdminWorkspaceShell>
  );
}

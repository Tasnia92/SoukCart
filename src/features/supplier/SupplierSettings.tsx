/* -----------------------------------------------------------------------------
 * Seller shop settings — profile contact fields, notification toggles,
 * fulfillment preferences, payout method, and password change.
 * -------------------------------------------------------------------------- */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BadgeCheck, KeyRound, RefreshCw, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  InlineNotice,
  LoadingState,
  PageHeader,
  WorkspaceError,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { formatDateTime } from "../workspace/format.ts";
import {
  loadSupplierShopSettings,
  payoutMethodLabel,
  sellerPasswordValidationError,
  shopSettingsValidationError,
  SELLER_PAYOUT_METHODS,
  updateSellerPassword,
  updateSellerShopSettings,
  verificationStatusLabel,
  type SellerPayoutMethod,
  type SupplierShopSettings,
} from "./supplier-settings-api.ts";
import { SupplierWorkspaceShell, type SupplierNotice } from "./supplier-shared.tsx";

type SupplierSettingsProps = {
  loadSettings?: (userId: string) => Promise<SupplierShopSettings | null>;
};

type SettingsFormState = {
  shopName: string;
  shopDetails: string;
  location: string;
  contactPhone: string;
  deliveryCoverage: string;
  processingTimeHours: string;
  payoutMethod: SellerPayoutMethod;
  notifyOrders: boolean;
  notifyStock: boolean;
  notifyPayouts: boolean;
};

function formFromSettings(settings: SupplierShopSettings): SettingsFormState {
  return {
    shopName: settings.shop_name,
    shopDetails: settings.shop_details,
    location: settings.location,
    contactPhone: settings.contact_phone,
    deliveryCoverage: settings.delivery_coverage,
    processingTimeHours: String(settings.processing_time_hours),
    payoutMethod: settings.payout_method,
    notifyOrders: settings.notify_orders,
    notifyStock: settings.notify_stock,
    notifyPayouts: settings.notify_payouts,
  };
}

function verificationBadgeVariant(
  status: SupplierShopSettings["status"],
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "approved") return "default";
  if (status === "rejected") return "destructive";
  return "secondary";
}

export function SupplierSettings({
  loadSettings = loadSupplierShopSettings,
}: SupplierSettingsProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/supplier/settings" });
  const [settings, setSettings] = useState<SupplierShopSettings | null>(null);
  const [form, setForm] = useState<SettingsFormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<SupplierNotice | null>(null);
  const [passwordNotice, setPasswordNotice] = useState<SupplierNotice | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const retry = useCallback(() => setLoadVersion((version) => version + 1), []);

  useEffect(() => {
    if (state.status !== "seller") return;
    let current = true;
    setError(null);
    setLoading(true);

    void loadSettings(state.profile.id)
      .then((next) => {
        if (!current) return;
        if (!next) {
          setError("Verified shop profile not found.");
          setSettings(null);
          setForm(null);
          return;
        }
        setSettings(next);
        setForm(formFromSettings(next));
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });

    return () => {
      current = false;
    };
  }, [loadSettings, loadVersion, state]);

  if (state.status !== "seller") return null;

  const onLogout = () => {
    void store.signOut().then(() => {
      void navigate({ to: "/" });
    });
  };
  const userName = state.profile.name || state.profile.email;

  if (error && !settings) {
    return (
      <WorkspaceError
        eyebrow="Seller workspace"
        title="We could not load your shop settings."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const onSaveSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form || saving) return;

    const processingTimeHours = Number(form.processingTimeHours);
    const input = {
      shopName: form.shopName,
      shopDetails: form.shopDetails,
      location: form.location,
      contactPhone: form.contactPhone,
      deliveryCoverage: form.deliveryCoverage,
      processingTimeHours,
      payoutMethod: form.payoutMethod,
      notifyOrders: form.notifyOrders,
      notifyStock: form.notifyStock,
      notifyPayouts: form.notifyPayouts,
    };
    const validationError = shopSettingsValidationError(input);
    if (validationError) {
      setNotice({ message: validationError, state: "error" });
      return;
    }

    setSaving(true);
    setNotice(null);
    void updateSellerShopSettings(input)
      .then((updated) => {
        setSettings((prev) =>
          prev
            ? {
                ...prev,
                shop_name: updated.shopName,
                shop_details: updated.shopDetails,
                location: updated.location,
                contact_phone: updated.contactPhone,
                delivery_coverage: updated.deliveryCoverage,
                processing_time_hours: updated.processingTimeHours,
                payout_method: updated.payoutMethod,
                notify_orders: updated.notifyOrders,
                notify_stock: updated.notifyStock,
                notify_payouts: updated.notifyPayouts,
                status: updated.status,
                updated_at: updated.updatedAt,
              }
            : prev,
        );
        setForm({
          shopName: updated.shopName,
          shopDetails: updated.shopDetails,
          location: updated.location,
          contactPhone: updated.contactPhone,
          deliveryCoverage: updated.deliveryCoverage,
          processingTimeHours: String(updated.processingTimeHours),
          payoutMethod: updated.payoutMethod,
          notifyOrders: updated.notifyOrders,
          notifyStock: updated.notifyStock,
          notifyPayouts: updated.notifyPayouts,
        });
        setNotice({ message: "Shop settings saved.", state: "success" });
      })
      .catch((saveError: unknown) => {
        setNotice({
          message: saveError instanceof Error ? saveError.message : "Please try again.",
          state: "error",
        });
      })
      .finally(() => setSaving(false));
  };

  const onSavePassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingPassword) return;

    const validationError = sellerPasswordValidationError(newPassword, confirmPassword);
    if (validationError) {
      setPasswordNotice({ message: validationError, state: "error" });
      return;
    }

    setSavingPassword(true);
    setPasswordNotice(null);
    void updateSellerPassword(newPassword)
      .then(() => {
        setNewPassword("");
        setConfirmPassword("");
        setPasswordNotice({ message: "Password updated.", state: "success" });
      })
      .catch((saveError: unknown) => {
        setPasswordNotice({
          message: saveError instanceof Error ? saveError.message : "Please try again.",
          state: "error",
        });
      })
      .finally(() => setSavingPassword(false));
  };

  return (
    <SupplierWorkspaceShell
      section="settings"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Account"
        title="Shop settings."
        copy="Keep your shop profile, notification preferences, and payout details up to date."
        actions={
          <Button type="button" variant="ghost" disabled={loading} onClick={retry}>
            {loading ? (
              <Spinner data-icon="inline-start" />
            ) : (
              <RefreshCw data-icon="inline-start" />
            )}
            Refresh
          </Button>
        }
      />

      {settings && form ? (
        <div className="flex flex-col gap-6">
          <InlineNotice message={notice?.message} state={notice?.state} />

          <form className="flex flex-col gap-6" onSubmit={onSaveSettings}>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Store className="size-4" aria-hidden="true" />
                  Shop profile
                </CardTitle>
                <CardDescription>
                  Public shop details retailers see across your catalog listings.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldSet>
                  <FieldLegend className="sr-only">Shop profile</FieldLegend>
                  <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <Field className="md:col-span-2">
                      <FieldLabel htmlFor="settings-shop-name" required>
                        Shop name
                      </FieldLabel>
                      <Input
                        id="settings-shop-name"
                        name="shopName"
                        value={form.shopName}
                        onChange={(event) =>
                          setForm((prev) =>
                            prev ? { ...prev, shopName: event.target.value } : prev,
                          )
                        }
                        maxLength={120}
                        required
                      />
                    </Field>
                    <Field className="md:col-span-2">
                      <FieldLabel htmlFor="settings-shop-details" required>
                        Description
                      </FieldLabel>
                      <Textarea
                        id="settings-shop-details"
                        name="shopDetails"
                        value={form.shopDetails}
                        onChange={(event) =>
                          setForm((prev) =>
                            prev ? { ...prev, shopDetails: event.target.value } : prev,
                          )
                        }
                        rows={4}
                        maxLength={2000}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="settings-location" required>
                        Location
                      </FieldLabel>
                      <Input
                        id="settings-location"
                        name="location"
                        value={form.location}
                        onChange={(event) =>
                          setForm((prev) =>
                            prev ? { ...prev, location: event.target.value } : prev,
                          )
                        }
                        maxLength={200}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="settings-contact-phone" required>
                        Contact phone
                      </FieldLabel>
                      <Input
                        id="settings-contact-phone"
                        name="contactPhone"
                        type="tel"
                        value={form.contactPhone}
                        onChange={(event) =>
                          setForm((prev) =>
                            prev ? { ...prev, contactPhone: event.target.value } : prev,
                          )
                        }
                        required
                      />
                    </Field>
                  </FieldGroup>
                </FieldSet>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BadgeCheck className="size-4" aria-hidden="true" />
                  Verification
                </CardTitle>
                <CardDescription>
                  Review status is managed by SoukCart admins and cannot be edited here.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={verificationBadgeVariant(settings.status)}>
                    {verificationStatusLabel(settings.status)}
                  </Badge>
                  {settings.reviewed_at ? (
                    <span className="text-sm text-muted-foreground">
                      Reviewed {formatDateTime(settings.reviewed_at)}
                    </span>
                  ) : null}
                </div>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <dt className="text-muted-foreground">Trade licence number</dt>
                    <dd className="font-medium">{settings.trade_license_number || "—"}</dd>
                  </div>
                  <div className="flex flex-col gap-1">
                    <dt className="text-muted-foreground">Documents on file</dt>
                    <dd className="flex flex-wrap gap-2">
                      <Badge variant={settings.nid_front_path ? "outline" : "secondary"}>
                        NID front {settings.nid_front_path ? "uploaded" : "missing"}
                      </Badge>
                      <Badge variant={settings.nid_back_path ? "outline" : "secondary"}>
                        NID back {settings.nid_back_path ? "uploaded" : "missing"}
                      </Badge>
                    </dd>
                  </div>
                </dl>
                {settings.review_note ? (
                  <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                    {settings.review_note}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Notification preferences</CardTitle>
                <CardDescription>
                  Choose which seller alerts you want to receive in the workspace.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup className="gap-3">
                  <Field orientation="horizontal">
                    <Checkbox
                      id="settings-notify-orders"
                      checked={form.notifyOrders}
                      onCheckedChange={(value) =>
                        setForm((prev) => (prev ? { ...prev, notifyOrders: value === true } : prev))
                      }
                    />
                    <FieldLabel htmlFor="settings-notify-orders">Order updates</FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <Checkbox
                      id="settings-notify-stock"
                      checked={form.notifyStock}
                      onCheckedChange={(value) =>
                        setForm((prev) => (prev ? { ...prev, notifyStock: value === true } : prev))
                      }
                    />
                    <FieldLabel htmlFor="settings-notify-stock">Low-stock alerts</FieldLabel>
                  </Field>
                  <Field orientation="horizontal">
                    <Checkbox
                      id="settings-notify-payouts"
                      checked={form.notifyPayouts}
                      onCheckedChange={(value) =>
                        setForm((prev) =>
                          prev ? { ...prev, notifyPayouts: value === true } : prev,
                        )
                      }
                    />
                    <FieldLabel htmlFor="settings-notify-payouts">Payout updates</FieldLabel>
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Fulfillment and payouts</CardTitle>
                <CardDescription>
                  Tell retailers what you cover and how you prefer to get paid.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field className="md:col-span-2">
                    <FieldLabel htmlFor="settings-delivery-coverage">Delivery coverage</FieldLabel>
                    <Textarea
                      id="settings-delivery-coverage"
                      name="deliveryCoverage"
                      value={form.deliveryCoverage}
                      onChange={(event) =>
                        setForm((prev) =>
                          prev ? { ...prev, deliveryCoverage: event.target.value } : prev,
                        )
                      }
                      rows={3}
                      maxLength={500}
                      placeholder="e.g. Dhaka metro, Chattogram city"
                    />
                    <FieldDescription>Optional. Up to 500 characters.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="settings-processing-time" required>
                      Processing time (hours)
                    </FieldLabel>
                    <Input
                      id="settings-processing-time"
                      name="processingTimeHours"
                      type="number"
                      min={1}
                      max={720}
                      step={1}
                      value={form.processingTimeHours}
                      onChange={(event) =>
                        setForm((prev) =>
                          prev ? { ...prev, processingTimeHours: event.target.value } : prev,
                        )
                      }
                      required
                    />
                    <FieldDescription>Typical time before an order ships (1–720).</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="settings-payout-method" required>
                      Payout method
                    </FieldLabel>
                    <Select
                      value={form.payoutMethod}
                      onValueChange={(value) =>
                        setForm((prev) =>
                          prev ? { ...prev, payoutMethod: value as SellerPayoutMethod } : prev,
                        )
                      }
                    >
                      <SelectTrigger id="settings-payout-method" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {SELLER_PAYOUT_METHODS.map((method) => (
                            <SelectItem key={method} value={method}>
                              {payoutMethodLabel(method)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>
              </CardContent>
            </Card>

            <div className="flex justify-end">
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner data-icon="inline-start" /> : null}
                Save settings
              </Button>
            </div>
          </form>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-4" aria-hidden="true" />
                Password
              </CardTitle>
              <CardDescription>Update the password for this seller account.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <InlineNotice message={passwordNotice?.message} state={passwordNotice?.state} />
              <form className="flex flex-col gap-4" onSubmit={onSavePassword}>
                <FieldGroup className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="settings-new-password" required>
                      New password
                    </FieldLabel>
                    <Input
                      id="settings-new-password"
                      name="newPassword"
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      minLength={8}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="settings-confirm-password" required>
                      Confirm password
                    </FieldLabel>
                    <Input
                      id="settings-confirm-password"
                      name="confirmPassword"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      minLength={8}
                      required
                    />
                  </Field>
                </FieldGroup>
                <div className="flex justify-end">
                  <Button type="submit" variant="secondary" disabled={savingPassword}>
                    {savingPassword ? <Spinner data-icon="inline-start" /> : null}
                    Update password
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : (
        <LoadingState title="Loading shop settings…" />
      )}
    </SupplierWorkspaceShell>
  );
}

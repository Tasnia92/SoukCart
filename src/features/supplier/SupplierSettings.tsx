/* -----------------------------------------------------------------------------
 * Seller settings — shop profile, verification status, and password change
 * in a single card.
 * -------------------------------------------------------------------------- */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { BadgeCheck, KeyRound, RefreshCw, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
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
  sellerPasswordValidationError,
  shopSettingsValidationError,
  updateSellerPassword,
  updateSellerShopSettings,
  verificationStatusLabel,
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
};

function formFromSettings(settings: SupplierShopSettings): SettingsFormState {
  return {
    shopName: settings.shop_name,
    shopDetails: settings.shop_details,
    location: settings.location,
    contactPhone: settings.contact_phone,
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
        title="We could not load your settings."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const onSaveSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form || saving) return;

    const input = {
      shopName: form.shopName,
      shopDetails: form.shopDetails,
      location: form.location,
      contactPhone: form.contactPhone,
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
        });
        setNotice({ message: "Settings saved.", state: "success" });
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
        title="Settings."
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
        <Card>
          <CardContent className="flex flex-col gap-8">
            <form className="flex flex-col gap-8" onSubmit={onSaveSettings}>
              <InlineNotice message={notice?.message} state={notice?.state} />

              <FieldSet className="gap-3">
                <FieldLegend className="flex items-center gap-2">
                  <Store className="size-4" aria-hidden="true" />
                  Shop profile
                </FieldLegend>
                <FieldDescription>
                  Public shop details retailers see across your catalog listings.
                </FieldDescription>
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
                        setForm((prev) => (prev ? { ...prev, shopName: event.target.value } : prev))
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
                        setForm((prev) => (prev ? { ...prev, location: event.target.value } : prev))
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

              <FieldSet className="gap-3">
                <FieldLegend className="flex items-center gap-2">
                  <BadgeCheck className="size-4" aria-hidden="true" />
                  Verification
                </FieldLegend>
                <FieldDescription>Review status is managed by SoukCart admins.</FieldDescription>
                <div className="flex flex-col gap-4">
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
                </div>
              </FieldSet>

              <div className="flex justify-end">
                <Button type="submit" disabled={saving}>
                  {saving ? <Spinner data-icon="inline-start" /> : null}
                  Save settings
                </Button>
              </div>
            </form>

            <form className="flex flex-col gap-6 border-t pt-8" onSubmit={onSavePassword}>
              <FieldSet className="gap-3">
                <FieldLegend className="flex items-center gap-2">
                  <KeyRound className="size-4" aria-hidden="true" />
                  Password
                </FieldLegend>
                <FieldDescription>Update the password for this seller account.</FieldDescription>
                <InlineNotice message={passwordNotice?.message} state={passwordNotice?.state} />
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
              </FieldSet>
              <div className="flex justify-end">
                <Button type="submit" variant="secondary" disabled={savingPassword}>
                  {savingPassword ? <Spinner data-icon="inline-start" /> : null}
                  Update password
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <LoadingState title="Loading settings…" />
      )}
    </SupplierWorkspaceShell>
  );
}

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { KeyRound, LogOut, MapPin, Plus, Store, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  WorkspaceError,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { RetailerWorkspaceShell } from "./retailer-shared.tsx";
import {
  createRetailerShippingAddress,
  deleteRetailerShippingAddress,
  loadRetailerShippingAddresses,
  retailerAddressValidationError,
  retailerNameValidationError,
  retailerPasswordValidationError,
  setDefaultRetailerShippingAddress,
  updateRetailerName,
  updateRetailerPassword,
  updateRetailerShippingAddress,
  type RetailerAddressInput,
  type RetailerShippingAddress,
} from "./retailer-settings-api.ts";

type Notice = { message: string; state: "info" | "success" | "error" } | null;

const emptyAddressForm: RetailerAddressInput = {
  label: "",
  phone: "",
  address: "",
  city: "",
  postcode: "",
  isDefault: false,
};

function formFromAddress(address: RetailerShippingAddress): RetailerAddressInput {
  return {
    label: address.label,
    phone: address.phone,
    address: address.address,
    city: address.city,
    postcode: address.postcode,
    isDefault: address.is_default,
  };
}

export function RetailerSettings() {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const navigate = useNavigate({ from: "/retailer/settings" });
  const [displayName, setDisplayName] = useState("");
  const [addresses, setAddresses] = useState<RetailerShippingAddress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profileNotice, setProfileNotice] = useState<Notice>(null);
  const [addressNotice, setAddressNotice] = useState<Notice>(null);
  const [passwordNotice, setPasswordNotice] = useState<Notice>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [savingName, setSavingName] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [busyAddressId, setBusyAddressId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addressForm, setAddressForm] = useState<RetailerAddressInput>(emptyAddressForm);

  const retry = useCallback(() => setLoadVersion((version) => version + 1), []);
  const retailerId = state.status === "retailer" ? state.profile.id : "";

  useEffect(() => {
    if (state.status !== "retailer") return;
    setDisplayName(state.profile.name || "");
  }, [state]);

  useEffect(() => {
    if (!retailerId) return;
    let current = true;
    setError(null);

    void loadRetailerShippingAddresses(retailerId)
      .then((next) => {
        if (current) setAddresses(next);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [loadVersion, retailerId]);

  if (state.status !== "retailer") return null;

  const onLogout = () => {
    void store.signOut().then(() => {
      void navigate({ to: "/" });
    });
  };
  const userName = state.profile.name || state.profile.email;

  if (error && !addresses) {
    return (
      <WorkspaceError
        eyebrow="Retailer workspace"
        title="We could not load your settings."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const openCreateAddress = () => {
    setEditingId(null);
    setAddressForm({
      ...emptyAddressForm,
      isDefault: !(addresses && addresses.length > 0),
    });
    setEditorOpen(true);
  };

  const openEditAddress = (address: RetailerShippingAddress) => {
    setEditingId(address.id);
    setAddressForm(formFromAddress(address));
    setEditorOpen(true);
  };

  const onSaveName = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingName) return;
    const validationError = retailerNameValidationError(displayName);
    if (validationError) {
      setProfileNotice({ message: validationError, state: "error" });
      return;
    }
    setSavingName(true);
    setProfileNotice(null);
    void updateRetailerName(retailerId, displayName)
      .then(async (name) => {
        setDisplayName(name);
        await store.refresh();
        setProfileNotice({ message: "Display name saved.", state: "success" });
      })
      .catch((saveError: unknown) => {
        setProfileNotice({
          message: saveError instanceof Error ? saveError.message : "Please try again.",
          state: "error",
        });
      })
      .finally(() => setSavingName(false));
  };

  const onSavePassword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingPassword) return;
    const validationError = retailerPasswordValidationError(newPassword, confirmPassword);
    if (validationError) {
      setPasswordNotice({ message: validationError, state: "error" });
      return;
    }
    setSavingPassword(true);
    setPasswordNotice(null);
    void updateRetailerPassword(newPassword)
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

  const onSaveAddress = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (savingAddress) return;
    const validationError = retailerAddressValidationError(addressForm);
    if (validationError) {
      setAddressNotice({ message: validationError, state: "error" });
      return;
    }
    setSavingAddress(true);
    setAddressNotice(null);
    const save = editingId
      ? updateRetailerShippingAddress(editingId, addressForm)
      : createRetailerShippingAddress(retailerId, addressForm);
    void save
      .then(async () => {
        const next = await loadRetailerShippingAddresses(retailerId);
        setAddresses(next);
        setEditorOpen(false);
        setAddressNotice({
          message: editingId ? "Address updated." : "Address added.",
          state: "success",
        });
      })
      .catch((saveError: unknown) => {
        setAddressNotice({
          message: saveError instanceof Error ? saveError.message : "Please try again.",
          state: "error",
        });
      })
      .finally(() => setSavingAddress(false));
  };

  const onSetDefault = (addressId: string) => {
    setBusyAddressId(addressId);
    void setDefaultRetailerShippingAddress(retailerId, addressId)
      .then(() => loadRetailerShippingAddresses(retailerId))
      .then((next) => {
        setAddresses(next);
        setAddressNotice({ message: "Default delivery address updated.", state: "success" });
      })
      .catch((saveError: unknown) => {
        setAddressNotice({
          message: saveError instanceof Error ? saveError.message : "Please try again.",
          state: "error",
        });
      })
      .finally(() => setBusyAddressId(null));
  };

  const onDeleteAddress = (addressId: string) => {
    setBusyAddressId(addressId);
    void deleteRetailerShippingAddress(addressId)
      .then(() => loadRetailerShippingAddresses(retailerId))
      .then((next) => {
        setAddresses(next);
        setAddressNotice({ message: "Address removed.", state: "success" });
      })
      .catch((saveError: unknown) => {
        setAddressNotice({
          message: saveError instanceof Error ? saveError.message : "Please try again.",
          state: "error",
        });
      })
      .finally(() => setBusyAddressId(null));
  };

  return (
    <RetailerWorkspaceShell
      section="settings"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="Account"
        title="Settings."
        copy="Update your shop contact details and saved delivery addresses for checkout."
      />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="addresses">Delivery addresses</TabsTrigger>
          <TabsTrigger value="security">Password</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="flex flex-col gap-4">
          <InlineNotice message={profileNotice?.message} state={profileNotice?.state} />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Store className="size-4" aria-hidden="true" />
                Shop profile
              </CardTitle>
              <CardDescription>How your retailer account appears across SoukCart.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={onSaveName}>
                <FieldSet>
                  <FieldLegend className="sr-only">Profile</FieldLegend>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="retailer-display-name">Display name</FieldLabel>
                      <Input
                        id="retailer-display-name"
                        value={displayName}
                        onChange={(event) => setDisplayName(event.target.value)}
                        maxLength={120}
                        required
                      />
                      <FieldDescription>
                        Shown in your workspace header and orders.
                      </FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="retailer-email">Email</FieldLabel>
                      <Input id="retailer-email" value={state.profile.email} disabled readOnly />
                    </Field>
                  </FieldGroup>
                </FieldSet>
                <div className="flex justify-end">
                  <Button type="submit" disabled={savingName}>
                    {savingName ? <Spinner data-icon="inline-start" /> : null}
                    Save name
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="addresses" className="flex flex-col gap-4">
          <InlineNotice message={addressNotice?.message} state={addressNotice?.state} />
          <div className="flex justify-end">
            <Button type="button" onClick={openCreateAddress}>
              <Plus data-icon="inline-start" />
              Add address
            </Button>
          </div>
          {addresses ? (
            addresses.length ? (
              <ul className="grid gap-4 md:grid-cols-2">
                {addresses.map((address) => (
                  <li key={address.id}>
                    <Card size="sm">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <MapPin className="size-4" aria-hidden="true" />
                          {address.label}
                        </CardTitle>
                        <CardDescription>
                          {address.is_default ? <Badge>Default</Badge> : "Saved address"}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-3">
                        <p className="text-sm whitespace-pre-line">
                          {address.address}
                          {"\n"}
                          {address.city}, {address.postcode}
                          {"\n"}
                          {address.phone}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openEditAddress(address)}
                          >
                            Edit
                          </Button>
                          {!address.is_default ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={busyAddressId === address.id}
                              onClick={() => onSetDefault(address.id)}
                            >
                              Make default
                            </Button>
                          ) : null}
                          <Button
                            type="button"
                            size="sm"
                            variant="destructive"
                            disabled={busyAddressId === address.id}
                            onClick={() => onDeleteAddress(address.id)}
                          >
                            <Trash2 data-icon="inline-start" />
                            Remove
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={MapPin}
                title="No saved addresses yet"
                copy="Add a delivery address once, then select it quickly at checkout."
                action={
                  <Button type="button" onClick={openCreateAddress}>
                    <Plus data-icon="inline-start" />
                    Add address
                  </Button>
                }
              />
            )
          ) : (
            <LoadingState title="Loading addresses…" />
          )}
        </TabsContent>

        <TabsContent value="security" className="flex flex-col gap-4">
          <InlineNotice message={passwordNotice?.message} state={passwordNotice?.state} />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="size-4" aria-hidden="true" />
                Change password
              </CardTitle>
              <CardDescription>Use a strong password you do not reuse elsewhere.</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={onSavePassword}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="retailer-new-password">New password</FieldLabel>
                    <Input
                      id="retailer-new-password"
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="retailer-confirm-password">Confirm password</FieldLabel>
                    <Input
                      id="retailer-confirm-password"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      required
                    />
                  </Field>
                </FieldGroup>
                <div className="flex justify-end">
                  <Button type="submit" disabled={savingPassword}>
                    {savingPassword ? <Spinner data-icon="inline-start" /> : null}
                    Update password
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Card size="sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">Log out of SoukCart</p>
            <p className="text-sm text-muted-foreground">
              End your session on this device. Your cart and orders stay saved.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={onLogout}>
            <LogOut data-icon="inline-start" />
            Log out
          </Button>
        </CardContent>
      </Card>

      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit address" : "Add address"}</DialogTitle>
            <DialogDescription>
              These details are used when you place an order for delivery.
            </DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={onSaveAddress}>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="address-label">Label</FieldLabel>
                <Input
                  id="address-label"
                  placeholder="Shop front, Warehouse, Home"
                  value={addressForm.label}
                  onChange={(event) =>
                    setAddressForm((prev) => ({ ...prev, label: event.target.value }))
                  }
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="address-phone">Phone</FieldLabel>
                <Input
                  id="address-phone"
                  type="tel"
                  inputMode="tel"
                  placeholder="01XXXXXXXXX"
                  value={addressForm.phone}
                  onChange={(event) =>
                    setAddressForm((prev) => ({ ...prev, phone: event.target.value }))
                  }
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="address-line">Address</FieldLabel>
                <Input
                  id="address-line"
                  placeholder="House, road, area"
                  value={addressForm.address}
                  onChange={(event) =>
                    setAddressForm((prev) => ({ ...prev, address: event.target.value }))
                  }
                  required
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="address-city">City</FieldLabel>
                  <Input
                    id="address-city"
                    value={addressForm.city}
                    onChange={(event) =>
                      setAddressForm((prev) => ({ ...prev, city: event.target.value }))
                    }
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="address-postcode">Postcode</FieldLabel>
                  <Input
                    id="address-postcode"
                    value={addressForm.postcode}
                    onChange={(event) =>
                      setAddressForm((prev) => ({ ...prev, postcode: event.target.value }))
                    }
                    required
                  />
                </Field>
              </div>
              <Field orientation="horizontal">
                <Checkbox
                  id="address-default"
                  checked={Boolean(addressForm.isDefault)}
                  onCheckedChange={(checked) =>
                    setAddressForm((prev) => ({ ...prev, isDefault: checked === true }))
                  }
                />
                <FieldLabel htmlFor="address-default">Use as default at checkout</FieldLabel>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setEditorOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={savingAddress}>
                {savingAddress ? <Spinner data-icon="inline-start" /> : null}
                Save address
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </RetailerWorkspaceShell>
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, Search, Users, X } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  SearchToolbar,
  TableShell,
  WorkspaceError,
  type NoticeState,
} from "../../components/ui/Workspace.tsx";
import { useSessionSnapshot, useSessionStore } from "../../session.tsx";
import { formatDate, initials } from "../workspace/format.ts";
import { AdminWorkspaceShell } from "./admin-workspace-shell.tsx";
import {
  createAdminUser,
  deleteAdminUser,
  filterAdminUsers,
  loadAdminUsers,
  updateAdminUser,
  type AdminUser,
} from "./admin-users-api.ts";

type AdminUsersProps = {
  loadUsers?: () => Promise<AdminUser[]>;
};

type Notice = { message: string; state: NoticeState } | null;

const CREATE_PANEL_ID = "admin-create-panel";
const EDIT_PANEL_ID = "admin-edit-panel";
const UNASSIGNED_ROLE = "__unassigned__";

function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function readRole(formData: FormData): string {
  const role = readText(formData, "role");
  return role === UNASSIGNED_ROLE ? "" : role;
}

function RoleOptions() {
  return (
    <SelectGroup>
      <SelectItem value={UNASSIGNED_ROLE}>Let the user choose later</SelectItem>
      <SelectItem value="seller">Seller</SelectItem>
      <SelectItem value="retailer">Retailer</SelectItem>
      <SelectItem value="admin">Administrator</SelectItem>
    </SelectGroup>
  );
}

function UserRow({
  user,
  currentAdminId,
  busy,
  onEdit,
  onDelete,
}: {
  user: AdminUser;
  currentAdminId: string;
  busy: boolean;
  onEdit: (user: AdminUser) => void;
  onDelete: (user: AdminUser) => void;
}) {
  const status = user.email_confirmed_at ? "Verified" : "Pending";
  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar size="sm">
            <AvatarFallback>{initials(user.name || user.email)}</AvatarFallback>
          </Avatar>
          <span className="flex min-w-0 flex-col gap-1">
            <strong className="truncate font-medium">{user.name || "Unnamed user"}</strong>
            <small className="text-xs text-muted-foreground">{status}</small>
          </span>
        </div>
      </TableCell>
      <TableCell>{user.email}</TableCell>
      <TableCell>
        <code className="block max-w-44 truncate font-mono text-xs" title={user.id}>
          {user.id}
        </code>
      </TableCell>
      <TableCell>
        <Badge variant="outline">{user.role || "Needs setup"}</Badge>
      </TableCell>
      <TableCell>{formatDate(user.created_at)}</TableCell>
      <TableCell>
        {user.last_sign_in_at ? (
          formatDate(user.last_sign_in_at)
        ) : (
          <span className="text-muted-foreground">Never</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onEdit(user)}
          >
            Edit
          </Button>
          {user.id === currentAdminId ? (
            <Badge variant="secondary">You</Badge>
          ) : (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => onDelete(user)}
            >
              Delete
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

export function AdminUsers({ loadUsers = loadAdminUsers }: AdminUsersProps) {
  const { state } = useSessionSnapshot();
  const store = useSessionStore();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createFeedback, setCreateFeedback] = useState<Notice>(null);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [updating, setUpdating] = useState(false);
  const [editFeedback, setEditFeedback] = useState<Notice>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const createFormRef = useRef<HTMLFormElement>(null);
  const createNameRef = useRef<HTMLInputElement>(null);
  const editNameRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let current = true;
    setError(null);

    void loadUsers()
      .then((nextUsers) => {
        if (current) setUsers(nextUsers);
      })
      .catch((loadError: unknown) => {
        if (current) {
          setError(loadError instanceof Error ? loadError.message : "Please try again.");
        }
      });

    return () => {
      current = false;
    };
  }, [loadUsers, loadVersion]);

  useEffect(() => {
    if (createOpen) createNameRef.current?.focus();
  }, [createOpen]);

  useEffect(() => {
    if (editingUser) editNameRef.current?.focus();
  }, [editingUser]);

  if (state.status !== "admin") return null;

  const currentAdminId = state.session.user.id;
  const onLogout = () => {
    void store.signOut();
  };
  const retry = () => setLoadVersion((version) => version + 1);
  const userName = state.profile.name || "Administrator";

  if (error) {
    return (
      <WorkspaceError
        eyebrow="Admin workspace"
        title="We could not load the admin workspace."
        message={error}
        onRetry={retry}
        onLogout={onLogout}
      />
    );
  }

  const reload = () => setLoadVersion((version) => version + 1);

  const openCreate = () => {
    setEditingUser(null);
    setEditFeedback(null);
    setCreateFeedback(null);
    setCreateOpen(true);
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setCreateFeedback(null);
    createFormRef.current?.reset();
    triggerRef.current?.focus();
  };

  const onCreateOpenChange = (open: boolean) => {
    if (open) openCreate();
    else closeCreate();
  };

  const openEdit = (user: AdminUser) => {
    setCreateOpen(false);
    setCreateFeedback(null);
    setEditFeedback(null);
    setEditingUser(user);
  };

  const closeEdit = () => {
    setEditingUser(null);
    setEditFeedback(null);
  };

  const onCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    setCreating(true);
    setCreateFeedback({ message: "Creating account...", state: "info" });
    const formData = new FormData(form);
    try {
      await createAdminUser({
        name: readText(formData, "name"),
        email: readText(formData, "email"),
        password: readText(formData, "password"),
        role: readRole(formData),
      });
      form.reset();
      setCreateOpen(false);
      setCreateFeedback(null);
      setNotice({ message: "The new user was created successfully.", state: "success" });
      reload();
    } catch (createError) {
      setCreateFeedback({
        message:
          createError instanceof Error ? createError.message : "The user could not be created.",
        state: "error",
      });
    } finally {
      setCreating(false);
    }
  };

  const onUpdate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingUser) return;
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    setUpdating(true);
    setEditFeedback({ message: "Saving changes...", state: "info" });
    const formData = new FormData(form);
    try {
      const updated = await updateAdminUser({
        userId: editingUser.id,
        name: readText(formData, "name"),
        email: readText(formData, "email"),
        role: readRole(formData),
      });
      setUsers(
        (current) => current?.map((user) => (user.id === updated.id ? updated : user)) ?? current,
      );
      setEditingUser(null);
      setEditFeedback(null);
      setNotice({ message: `${updated.name || updated.email} was updated.`, state: "success" });
    } catch (updateError) {
      setEditFeedback({
        message:
          updateError instanceof Error ? updateError.message : "The user could not be updated.",
        state: "error",
      });
    } finally {
      setUpdating(false);
    }
  };

  const onConfirmDelete = () => {
    if (!deleteTarget) return;
    const user = deleteTarget;
    const displayName = user.name || user.email;
    setDeleteTarget(null);
    setDeletingId(user.id);
    void deleteAdminUser(user.id)
      .then(() => {
        setNotice({ message: `${displayName}'s account was deleted.`, state: "success" });
        reload();
      })
      .catch((deleteError: unknown) => {
        setNotice({
          message:
            deleteError instanceof Error ? deleteError.message : "The user could not be deleted.",
          state: "error",
        });
      })
      .finally(() => setDeletingId(null));
  };

  const filtered = users ? filterAdminUsers(users, searchTerm) : [];

  return (
    <AdminWorkspaceShell
      activePath="/admin/users"
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="People & access"
        title="User directory"
        copy="Search by ID number and create, edit, or remove user accounts."
        actions={
          <Dialog open={createOpen} onOpenChange={onCreateOpenChange}>
            <DialogTrigger asChild>
              <Button
                ref={triggerRef}
                type="button"
                aria-expanded={createOpen}
                aria-controls={CREATE_PANEL_ID}
              >
                <Plus data-icon="inline-start" />
                New user
              </Button>
            </DialogTrigger>
            {users ? (
              <DialogContent id={CREATE_PANEL_ID} showCloseButton={false}>
                <DialogHeader>
                  <DialogTitle>Create a user</DialogTitle>
                  <DialogDescription>Add a new account to the workspace.</DialogDescription>
                </DialogHeader>
                <DialogClose asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-4 right-4"
                    aria-label="Close create user form"
                  >
                    <X />
                  </Button>
                </DialogClose>
                <form ref={createFormRef} onSubmit={onCreate} noValidate>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="create-user-name">Full name</FieldLabel>
                      <Input
                        id="create-user-name"
                        ref={createNameRef}
                        name="name"
                        type="text"
                        autoComplete="name"
                        maxLength={100}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="create-user-email">Email address</FieldLabel>
                      <Input
                        id="create-user-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="create-user-password">Temporary password</FieldLabel>
                      <Input
                        id="create-user-password"
                        name="password"
                        type="password"
                        minLength={8}
                        autoComplete="new-password"
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="create-user-role">Account type</FieldLabel>
                      <Select name="role" defaultValue={UNASSIGNED_ROLE}>
                        <SelectTrigger id="create-user-role" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <RoleOptions />
                        </SelectContent>
                      </Select>
                    </Field>
                  </FieldGroup>
                  <InlineNotice message={createFeedback?.message} state={createFeedback?.state} />
                  <DialogFooter className="mt-6">
                    <Button type="button" variant="outline" onClick={closeCreate}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={creating}>
                      Create user
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            ) : null}
          </Dialog>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {users ? (
        <>
          <Dialog
            open={Boolean(editingUser)}
            onOpenChange={(open) => {
              if (!open) closeEdit();
            }}
          >
            {editingUser ? (
              <DialogContent id={EDIT_PANEL_ID} key={editingUser.id} showCloseButton={false}>
                <DialogHeader>
                  <DialogTitle>Edit user</DialogTitle>
                  <DialogDescription>Update account details and access type.</DialogDescription>
                </DialogHeader>
                <DialogClose asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="absolute top-4 right-4"
                    aria-label="Close edit user form"
                  >
                    <X />
                  </Button>
                </DialogClose>
                <form onSubmit={onUpdate} noValidate>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="edit-user-name">Full name</FieldLabel>
                      <Input
                        id="edit-user-name"
                        ref={editNameRef}
                        name="name"
                        type="text"
                        autoComplete="name"
                        maxLength={100}
                        defaultValue={editingUser.name}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="edit-user-email">Email address</FieldLabel>
                      <Input
                        id="edit-user-email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        defaultValue={editingUser.email}
                        required
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="edit-user-role">Account type</FieldLabel>
                      <Select name="role" defaultValue={editingUser.role ?? UNASSIGNED_ROLE}>
                        <SelectTrigger id="edit-user-role" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <RoleOptions />
                        </SelectContent>
                      </Select>
                    </Field>
                  </FieldGroup>
                  <InlineNotice message={editFeedback?.message} state={editFeedback?.state} />
                  <DialogFooter className="mt-6">
                    <Button type="button" variant="outline" onClick={closeEdit}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={updating}>
                      Save changes
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            ) : null}
          </Dialog>

          <SearchToolbar
            label="Search users"
            placeholder="Search by user ID number"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            result={`${filtered.length} of ${users.length} accounts`}
          />

          <TableShell>
            <Table className="min-w-[62rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>User ID</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Last active</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length ? (
                  filtered.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      currentAdminId={currentAdminId}
                      busy={deletingId === user.id || (updating && editingUser?.id === user.id)}
                      onEdit={openEdit}
                      onDelete={setDeleteTarget}
                    />
                  ))
                ) : users.length ? (
                  <TableRow>
                    <TableCell className="p-0" colSpan={7}>
                      <EmptyState
                        icon={Search}
                        title="No matching users"
                        copy="Try a different ID, email, or name."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  <TableRow>
                    <TableCell className="p-0" colSpan={7}>
                      <EmptyState
                        icon={Users}
                        title="No users yet"
                        copy="New registrations will appear here automatically."
                      />
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableShell>
        </>
      ) : (
        <LoadingState title="Loading the admin workspace…" />
      )}

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this user account?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget
                ? `Delete ${deleteTarget.name || deleteTarget.email}'s account? This cannot be undone.`
                : "This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <AlertDialogAction type="button" variant="destructive" onClick={onConfirmDelete}>
              Delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminWorkspaceShell>
  );
}

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, buttonClassName } from "../../components/ui/Button.tsx";
import {
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
import { WorkspaceShell } from "../workspace/WorkspaceShell.tsx";
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

function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function RoleOptions() {
  return (
    <>
      <option value="">Let the user choose later</option>
      <option value="seller">Seller</option>
      <option value="retailer">Retailer</option>
      <option value="admin">Administrator</option>
    </>
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
    <tr>
      <td>
        <div className="admin-user-cell">
          <span className="admin-avatar">{initials(user.name || user.email)}</span>
          <span>
            <strong>{user.name || "Unnamed user"}</strong>
            <small>{status}</small>
          </span>
        </div>
      </td>
      <td>{user.email}</td>
      <td>
        <code className="admin-user-id" title={user.id}>
          {user.id}
        </code>
      </td>
      <td>
        <span className="admin-role">{user.role || "Needs setup"}</span>
      </td>
      <td>{formatDate(user.created_at)}</td>
      <td>
        {user.last_sign_in_at ? (
          formatDate(user.last_sign_in_at)
        ) : (
          <span className="admin-muted">Never</span>
        )}
      </td>
      <td className="admin-action-cell">
        <div className="admin-create-actions">
          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={() => onEdit(user)}
          >
            Edit
          </button>
          {user.id === currentAdminId ? (
            <span className="admin-current-user">You</span>
          ) : (
            <button
              className="delete-button"
              type="button"
              disabled={busy}
              onClick={() => onDelete(user)}
            >
              Delete
            </button>
          )}
        </div>
      </td>
    </tr>
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
        role: readText(formData, "role"),
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
        role: readText(formData, "role"),
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

  const onDelete = (user: AdminUser) => {
    const displayName = user.name || user.email;
    if (!window.confirm(`Delete ${displayName}'s account? This cannot be undone.`)) return;
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
    <WorkspaceShell
      navigationLabel="Admin navigation"
      items={[
        { to: "/admin", icon: "layers", label: "Overview" },
        { to: "/admin/activity", icon: "activity", label: "Order activity" },
        { to: "/admin/complaints", icon: "message", label: "Disputes & Claims" },
        { to: "/admin/verifications", icon: "shield-check", label: "Supplier verifications" },
        { to: "/admin/users", icon: "person", label: "User directory", active: true },
      ]}
      userName={userName}
      userEmail={state.profile.email}
      onLogout={onLogout}
    >
      <PageHeader
        eyebrow="People & access"
        title="User directory"
        copy="Search by ID number and create, edit, or remove user accounts."
        actions={
          <button
            ref={triggerRef}
            type="button"
            className={buttonClassName()}
            onClick={openCreate}
            aria-expanded={createOpen}
            aria-controls={CREATE_PANEL_ID}
          >
            <span>+ New user</span>
          </button>
        }
      />
      <InlineNotice message={notice?.message} state={notice?.state} />
      {users ? (
        <>
          <div className="admin-create-panel" id={CREATE_PANEL_ID} hidden={!createOpen}>
            <div className="admin-create-heading">
              <div>
                <p className="eyebrow">Add to workspace</p>
                <h3 className="display-sm">Create a user</h3>
              </div>
              <button
                className="icon-button"
                type="button"
                onClick={closeCreate}
                aria-label="Close create user form"
              >
                ×
              </button>
            </div>
            <form className="admin-create-form" ref={createFormRef} onSubmit={onCreate} noValidate>
              <label className="admin-field">
                <span>Full name</span>
                <input
                  ref={createNameRef}
                  name="name"
                  type="text"
                  autoComplete="name"
                  maxLength={100}
                  required
                />
              </label>
              <label className="admin-field">
                <span>Email address</span>
                <input name="email" type="email" autoComplete="email" required />
              </label>
              <label className="admin-field">
                <span>Temporary password</span>
                <input
                  name="password"
                  type="password"
                  minLength={8}
                  autoComplete="new-password"
                  required
                />
              </label>
              <label className="admin-field">
                <span>Account type</span>
                <select name="role" defaultValue="">
                  <RoleOptions />
                </select>
              </label>
              <div className="admin-create-actions">
                <Button variant="secondary" onClick={closeCreate}>
                  Cancel
                </Button>
                <Button type="submit" disabled={creating}>
                  <span>Create user</span>
                </Button>
              </div>
              <p
                className={`admin-form-feedback${createFeedback ? ` is-visible is-${createFeedback.state}` : ""}`}
                role="status"
                aria-live="polite"
              >
                {createFeedback?.message}
              </p>
            </form>
          </div>

          {editingUser ? (
            <div className="admin-create-panel" id={EDIT_PANEL_ID}>
              <div className="admin-create-heading">
                <div>
                  <p className="eyebrow">Account details</p>
                  <h3 className="display-sm">Edit user</h3>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  onClick={closeEdit}
                  aria-label="Close edit user form"
                >
                  ×
                </button>
              </div>
              <form
                className="admin-create-form"
                key={editingUser.id}
                onSubmit={onUpdate}
                noValidate
              >
                <label className="admin-field">
                  <span>Full name</span>
                  <input
                    ref={editNameRef}
                    name="name"
                    type="text"
                    autoComplete="name"
                    maxLength={100}
                    defaultValue={editingUser.name}
                    required
                  />
                </label>
                <label className="admin-field">
                  <span>Email address</span>
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    defaultValue={editingUser.email}
                    required
                  />
                </label>
                <label className="admin-field">
                  <span>Account type</span>
                  <select name="role" defaultValue={editingUser.role ?? ""}>
                    <RoleOptions />
                  </select>
                </label>
                <div className="admin-create-actions">
                  <Button variant="secondary" onClick={closeEdit}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={updating}>
                    <span>Save changes</span>
                  </Button>
                </div>
                <p
                  className={`admin-form-feedback${editFeedback ? ` is-visible is-${editFeedback.state}` : ""}`}
                  role="status"
                  aria-live="polite"
                >
                  {editFeedback?.message}
                </p>
              </form>
            </div>
          ) : null}

          <SearchToolbar
            label="Search users"
            placeholder="Search by user ID number"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            result={`${filtered.length} of ${users.length} accounts`}
          />

          <TableShell>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Email</th>
                  <th>User ID</th>
                  <th>Type</th>
                  <th>Joined</th>
                  <th>Last active</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.length ? (
                  filtered.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      currentAdminId={currentAdminId}
                      busy={deletingId === user.id || (updating && editingUser?.id === user.id)}
                      onEdit={openEdit}
                      onDelete={onDelete}
                    />
                  ))
                ) : users.length ? (
                  <tr>
                    <td className="admin-empty" colSpan={7}>
                      <strong>No matching users</strong>
                      <span>Try a different ID, email, or name.</span>
                    </td>
                  </tr>
                ) : (
                  <tr>
                    <td className="admin-empty" colSpan={7}>
                      <strong>No users yet</strong>
                      <span>New registrations will appear here automatically.</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableShell>
        </>
      ) : (
        <LoadingState title="Loading the admin workspace…" />
      )}
    </WorkspaceShell>
  );
}

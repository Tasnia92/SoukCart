export type AuthMode = "login" | "register";
export type AuthShellVariant = "public" | "admin";

/**
 * The two self-service account paths a signed-out visitor can choose between.
 * Mirrors the `AccountRole` union in session.tsx ("seller" is surfaced as
 * "Supplier" in copy).
 */
export type AuthRole = "retailer" | "seller";
export type LoginRole = AuthRole | "admin";
export type AuthFeedbackState = "error" | "info" | "success";

export type AuthFeedback = {
  message: string;
  state?: AuthFeedbackState;
};

export type LoginCredentials = {
  email: string;
  password: string;
  remember: boolean;
};

export type RegistrationDetails = {
  email: string;
  name: string;
  password: string;
};

export type AuthCallback<T> = (values: T) => AuthFeedback | void | Promise<AuthFeedback | void>;

export type AuthCallbackWithRole<T, R = AuthRole> = (
  values: T,
  role: R,
) => AuthFeedback | void | Promise<AuthFeedback | void>;

export type AuthFormSubmitHandler<T> = (values: T) => void | Promise<void>;

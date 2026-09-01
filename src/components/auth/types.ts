export type AuthMode = "login" | "register";
export type AuthShellVariant = "public" | "admin";
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

export type AuthFormSubmitHandler<T> = (values: T) => void | Promise<void>;

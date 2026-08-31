import { supabase } from "../supabase.ts";
import { renderIcon } from "./Icon.ts";
import { renderBrand } from "./Brand.ts";
import { renderAuthShell, type AuthMode } from "./AuthShell.ts";

type Profile = {
  id: string;
  email: string;
  name: string;
  role: string;
};

export function renderAuthApp(root: HTMLDivElement): void {
  let mode: AuthMode = "login";

  const render = (html: string) => {
    root.innerHTML = html;
  };

  const renderAuth = () => render(renderAuthShell(mode));

  const boot = async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      renderAuth();
      return;
    }

    const { data: profile } = await supabase
      .from("users")
      .select("id, email, name, role")
      .eq("id", data.session.user.id)
      .single();

    const role = (profile as Profile | null)?.role ?? "";
    if (role === "admin") {
      window.location.assign("/admin");
      return;
    }
    if (role === "retailer") {
      window.location.assign("/retailer");
      return;
    }
    if (role === "seller") {
      window.location.assign("/supplier");
      return;
    }
    if (role) {
      renderDone();
    } else {
      renderRole();
    }
  };

  const renderRole = () => {
    render(`<div class="plain-screen">
      ${renderBrand()}
      <p class="eyebrow">Account type</p>
      <h1 class="display-xl plain-title">Choose your account type</h1>
      <p class="plain-copy">Tell us how you'll use SoukCart so we can set up the right workspace for you.</p>
      <div class="role-options">
        <button class="button button-primary" type="button" data-role="seller"><span>I'm a seller</span></button>
        <button class="button button-subtle" type="button" data-role="retailer"><span>I'm a retailer</span></button>
      </div>
      <p class="form-feedback" data-form-feedback role="status" aria-live="polite"></p>
    </div>`);
  };

  const renderDone = () => {
    render(`<div class="plain-screen">
      ${renderBrand()}
      <p class="eyebrow">Signed in</p>
      <h1 class="display-xl plain-title">You're signed in.</h1>
      <p class="plain-copy">Welcome to SoukCart. Your workspace is ready.</p>
      <button class="button button-primary done-button" type="button" data-logout><span>Log out</span></button>
    </div>`);
  };

  root.addEventListener("click", async (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    const logout = event.target.closest<HTMLButtonElement>("[data-logout]");
    if (logout) {
      await supabase.auth.signOut();
      renderAuth();
      return;
    }

    const roleButton = event.target.closest<HTMLButtonElement>("[data-role]");
    if (roleButton) {
      const role = roleButton.dataset.role;
      const { data: user } = await supabase.auth.getUser();
      if (!role || !user.user) {
        return;
      }
      const { error } = await supabase.from("users").update({ role }).eq("id", user.user.id);
      if (error) {
        setFeedback(root.querySelector("[data-form-feedback]"), error.message, "error");
        return;
      }
      await boot();
      return;
    }

    const switchButton = event.target.closest<HTMLButtonElement>("[data-switch-auth]");
    if (switchButton) {
      mode = switchButton.dataset.switchAuth === "register" ? "register" : "login";
      renderAuth();
      root.querySelector<HTMLElement>("#auth-title")?.focus();
      return;
    }

    const passwordToggle = event.target.closest<HTMLButtonElement>("[data-password-toggle]");
    if (passwordToggle) {
      const inputId = passwordToggle.getAttribute("aria-controls");
      const input = inputId ? document.getElementById(inputId) : null;
      if (!(input instanceof HTMLInputElement)) {
        return;
      }

      const shouldShow = input.type === "password";
      input.type = shouldShow ? "text" : "password";
      passwordToggle.setAttribute("aria-pressed", String(shouldShow));
      passwordToggle.setAttribute(
        "aria-label",
        `${shouldShow ? "Hide" : "Show"} ${input.labels?.[0]?.textContent?.toLowerCase() ?? "password"}`,
      );
      passwordToggle.innerHTML = renderIcon(shouldShow ? "eye" : "eye-off", "input-action-icon");
      return;
    }

    const socialButton = event.target.closest<HTMLButtonElement>("[data-social-provider]");
    if (socialButton) {
      setFeedback(
        socialButton.form,
        `${socialButton.dataset.socialProvider} sign in will be available when authentication is connected.`,
      );
      return;
    }

    const forgotButton = event.target.closest<HTMLButtonElement>("[data-forgot-password]");
    if (forgotButton) {
      setFeedback(
        forgotButton.form,
        "Password recovery will be available when authentication is connected.",
      );
      return;
    }

    const termsButton = event.target.closest<HTMLButtonElement>("[data-terms]");
    if (termsButton) {
      setFeedback(
        termsButton.form ?? root.querySelector<HTMLFormElement>("[data-auth-form]"),
        "Terms and privacy details will be available soon.",
      );
    }
  });

  root.addEventListener("submit", async (event) => {
    if (!(event.target instanceof HTMLFormElement) || !event.target.matches("[data-auth-form]")) {
      return;
    }

    event.preventDefault();
    const form = event.target;
    const password = form.elements.namedItem("password");
    const confirmation = form.elements.namedItem("confirm-password");

    if (password instanceof HTMLInputElement && confirmation instanceof HTMLInputElement) {
      confirmation.setCustomValidity(
        password.value === confirmation.value ? "" : "Passwords do not match.",
      );
    }

    if (!form.reportValidity()) {
      return;
    }

    const formData = new FormData(form);
    const email = (formData.get("email") ?? "") as string;
    const pass = (formData.get("password") ?? "") as string;

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
      if (error) {
        setFeedback(form, error.message, "error");
        return;
      }
      await boot();
      return;
    }

    const name = (formData.get("name") ?? "") as string;
    const { error } = await supabase.auth.signUp({
      email,
      password: pass,
      options: { data: { name } },
    });
    if (error) {
      setFeedback(form, error.message, "error");
      return;
    }
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: pass,
    });
    if (signInError) {
      setFeedback(
        form,
        "Account created. Please check your email to confirm your account, then sign in.",
        "success",
      );
      return;
    }
    await boot();
  });

  void boot();
}

function setFeedback(form: HTMLFormElement | null, message: string, state = "info"): void {
  const feedback = form?.querySelector<HTMLElement>("[data-form-feedback]");
  if (!feedback) {
    return;
  }

  feedback.className = `form-feedback is-visible is-${state}`;
  feedback.textContent = message;
}

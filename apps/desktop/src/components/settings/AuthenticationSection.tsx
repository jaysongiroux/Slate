import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const bannerEnter =
  "motion-safe:animate-[settings-banner-enter_0.28s_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none";

export interface AuthenticationSectionProps {
  isAuthenticated: boolean;
  displayName: string | undefined;
  accountEmail: string | undefined;
  passwordAuthAvailable: boolean;
  oidcProviders: { id: string; type: string; label: string }[];
  authEmail: string;
  authPassword: string;
  onAuthEmailChange: (value: string) => void;
  onAuthPasswordChange: (value: string) => void;
  authSubmitting: boolean;
  authError: string;
  authEmailId: string;
  authEmailErrorId: string;
  authPasswordId: string;
  authPasswordErrorId: string;
  showEmailError: boolean;
  showPasswordError: boolean;
  emailError: string | null;
  passwordError: string | null;
  onEmailBlur: () => void;
  onPasswordBlur: () => void;
  onLoginSubmit: (event: React.FormEvent) => void;
  onLoginWithOidc: (providerId: string) => Promise<void>;
  onCancelOidc: () => void;
  onSignOut: () => Promise<void>;
  SettingsFieldError: React.ComponentType<{ id: string; message: string }>;
}

export function AuthenticationSection({
  isAuthenticated,
  displayName,
  accountEmail,
  passwordAuthAvailable,
  oidcProviders,
  authEmail,
  authPassword,
  onAuthEmailChange,
  onAuthPasswordChange,
  authSubmitting,
  authError,
  authEmailId,
  authEmailErrorId,
  authPasswordId,
  authPasswordErrorId,
  showEmailError,
  showPasswordError,
  emailError,
  passwordError,
  onEmailBlur,
  onPasswordBlur,
  onLoginSubmit,
  onLoginWithOidc,
  onCancelOidc,
  onSignOut,
  SettingsFieldError,
}: AuthenticationSectionProps) {
  return (
    <>
      {isAuthenticated ? (
        <div
          className={cn(
            "grid gap-2 rounded-[14px] border border-white/[0.06] bg-white/[0.04] p-3.5",
            "motion-safe:animate-[settings-banner-enter_0.32s_cubic-bezier(0.22,1,0.36,1)_both] motion-reduce:animate-none",
          )}
        >
          <div className="text-[0.96rem] font-semibold text-foreground">
            {displayName || accountEmail || "Signed in"}
          </div>
          {displayName && accountEmail && displayName !== accountEmail ? (
            <div className="text-[0.88rem] text-muted">{accountEmail}</div>
          ) : displayName && !accountEmail ? (
            <div className="text-[0.88rem] text-muted">Session active</div>
          ) : !displayName && !accountEmail ? (
            <div className="text-[0.88rem] text-muted">Session active</div>
          ) : null}
          <Button
            variant="dialog-secondary"
            onClick={() => void onSignOut()}
            disabled={authSubmitting}
          >
            Sign out
          </Button>
        </div>
      ) : passwordAuthAvailable || oidcProviders.length > 0 ? (
        <>
          {oidcProviders.length > 0 ? (
            <div className="grid gap-3">
              <div className="text-[0.84rem] text-muted">Single sign-on</div>
              <div className="flex flex-wrap items-center gap-2">
                {oidcProviders.map((provider) => (
                  <Button
                    key={provider.id}
                    variant="dialog-secondary"
                    onClick={() => void onLoginWithOidc(provider.id)}
                    disabled={authSubmitting}
                  >
                    {authSubmitting ? "Waiting for browser…" : `Continue with ${provider.label}`}
                  </Button>
                ))}
                {authSubmitting ? (
                  <Button variant="dialog-secondary" type="button" onClick={onCancelOidc}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {passwordAuthAvailable ? (
            <form className="grid gap-3" onSubmit={onLoginSubmit} noValidate>
              <div className="grid gap-1.5">
                <label htmlFor={authEmailId} className="text-[0.84rem] text-muted">
                  Email
                </label>
                <Input
                  id={authEmailId}
                  variant="bordered"
                  invalid={showEmailError}
                  type="email"
                  autoComplete="username"
                  inputMode="email"
                  value={authEmail}
                  onChange={(event) => onAuthEmailChange(event.target.value)}
                  onBlur={onEmailBlur}
                  placeholder="you@example.com"
                  aria-invalid={showEmailError}
                  aria-describedby={showEmailError ? authEmailErrorId : undefined}
                />
                {showEmailError ? (
                  <SettingsFieldError id={authEmailErrorId} message={emailError!} />
                ) : null}
              </div>

              <div className="grid gap-1.5">
                <label htmlFor={authPasswordId} className="text-[0.84rem] text-muted">
                  Password
                </label>
                <Input
                  id={authPasswordId}
                  variant="bordered"
                  invalid={showPasswordError}
                  type="password"
                  autoComplete="current-password"
                  value={authPassword}
                  onChange={(event) => onAuthPasswordChange(event.target.value)}
                  onBlur={onPasswordBlur}
                  placeholder="Password"
                  aria-invalid={showPasswordError}
                  aria-describedby={showPasswordError ? authPasswordErrorId : undefined}
                />
                {showPasswordError ? (
                  <SettingsFieldError id={authPasswordErrorId} message={passwordError!} />
                ) : null}
              </div>

              <p className="m-0 text-[0.78rem] leading-snug text-faint">
                Account creation is managed by an administrator through the admin portal.
              </p>

              <Button
                variant="dialog-primary"
                type="submit"
                disabled={authSubmitting || !authEmail.trim() || !authPassword}
              >
                {authSubmitting ? "Signing in…" : "Sign in with password"}
              </Button>
            </form>
          ) : null}
        </>
      ) : (
        <p className="break-words text-[0.94rem] text-foreground">
          No password authentication provider is available on this server.
        </p>
      )}

      {authError ? (
        <div
          className={cn(
            "rounded-lg px-3 py-2 text-[0.84rem] bg-[rgba(255,146,136,0.12)] text-danger",
            bannerEnter,
          )}
          role="alert"
        >
          {authError}
        </div>
      ) : null}
    </>
  );
}

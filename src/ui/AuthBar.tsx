import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { createGuest, githubLoginUrl, loginWithGoogle, logout } from "../api/auth";
import type { AuthMe } from "../api/types";
import { LanguageSelect } from "./LanguageSelect";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (
            parent: HTMLElement,
            options: { theme?: string; size?: string; text?: string; width?: number },
          ) => void;
        };
      };
    };
  }
}

export function AuthBar({
  auth,
  onAuthChange,
}: {
  auth: AuthMe | null;
  onAuthChange: (next: AuthMe) => void;
}) {
  const { t } = useTranslation();
  const buttonRef = useRef<HTMLDivElement>(null);
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId || auth?.authenticated) return;
    const googleClientId = clientId;
    let cancelled = false;
    function mount(): boolean {
      if (cancelled || !window.google || !buttonRef.current) return false;
      buttonRef.current.innerHTML = "";
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response) => {
          void loginWithGoogle(response.credential).then(onAuthChange);
        },
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "outline",
        size: "large",
        text: "signin_with",
      });
      return true;
    }
    if (mount()) return;
    const timer = setInterval(() => {
      if (mount()) clearInterval(timer);
    }, 200);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [auth?.authenticated, clientId, onAuthChange]);

  async function onLogout() {
    await logout();
    onAuthChange(await createGuest());
  }

  return (
    <div className="auth-bar">
      <LanguageSelect />
      {auth?.user ? (
        <p className="auth-status">
          {auth.user.avatarUrl && <img src={auth.user.avatarUrl} alt="" />}
          <span>{t("signedIn", { name: auth.user.displayName })}</span>
          <button type="button" className="text-btn" onClick={() => void onLogout()}>
            {t("signOut")}
          </button>
        </p>
      ) : (
        <div className="auth-actions">
          <p>{t("guestHint")}</p>
          {clientId && auth?.providers?.google !== false ? <div ref={buttonRef} /> : null}
          {auth?.providers?.github ? (
            <a className="github-btn" href={githubLoginUrl()}>
              {t("githubSignIn")}
            </a>
          ) : null}
        </div>
      )}
    </div>
  );
}

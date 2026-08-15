import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { PostHogProvider } from "@posthog/react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AuthProvider } from "@/lib/auth";
import { I18nProvider, useT } from "@/lib/i18n";
import { Toaster } from "@/components/ui/sonner";
import { ConfirmHost } from "@/components/confirm-dialog";

function isStaleDeploymentAsset(error: Error) {
  const message = `${error.name}: ${error.message}`.toLowerCase();
  return [
    "failed to fetch dynamically imported module",
    "importing a module script failed",
    "loading chunk",
    "chunkloaderror",
  ].some((fragment) => message.includes(fragment));
}

function NotFoundComponent() {
  const { t } = useT();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">{t("error.notFound")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("error.notFoundDesc")}
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {t("error.backHome")}
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });

    // A browser tab kept open across a Vercel deploy can request an old lazy
    // route chunk that no longer exists. Refresh once to load the new manifest;
    // keep the regular error UI if the error survives the refresh.
    if (isStaleDeploymentAsset(error)) {
      const key = `dash-reloaded-for-assets:${window.location.href}`;
      if (!window.sessionStorage.getItem(key)) {
        window.sessionStorage.setItem(key, "1");
        window.location.reload();
      }
    }
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        {/* Error components render outside RootComponent, therefore outside I18nProvider. */}
        <h1 className="text-xl font-semibold">Terjadi kesalahan</h1>
        <p className="mt-2 text-sm text-muted-foreground">Coba muat ulang halaman.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Coba lagi
          </button>
        </div>
      </div>
    </div>
  );
}

function AnalyticsProvider({ children }: { children: ReactNode }) {
  const apiKey = import.meta.env.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;

  // PostHog emits warnings and can fall back to a global instance when its
  // project token is absent in an environment. Do not mount that fallback:
  // analytics is optional, whereas navigating the payroll system is not.
  if (!apiKey) return <>{children}</>;

  return (
    <PostHogProvider
      apiKey={apiKey}
      options={{
        api_host: "/ingest",
        ui_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST || "https://us.posthog.com",
        defaults: "2025-05-24",
        capture_exceptions: true,
        debug: import.meta.env.DEV,
      }}
    >
      {children}
    </PostHogProvider>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Dash PULSE — Sistem Payroll Rider" },
      {
        name: "description",
        content:
          "Dash PULSE, PT. Dash Elektrik Indonesia — kelola skema pricing, attendance, potongan, dan slip gaji rider dari satu tempat.",
      },
      { property: "og:title", content: "Dash PULSE — Sistem Payroll Rider" },
      {
        property: "og:description",
        content:
          "Kelola skema pricing, attendance, potongan, dan slip gaji rider dari satu tempat.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Dash PULSE" },
      { name: "twitter:description", content: "Sistem payroll terpadu untuk operasional rider." },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/dash-icon-tab-v5.png?v=5" },
      { rel: "shortcut icon", type: "image/png", href: "/dash-icon-tab-v5.png?v=5" },
      { rel: "apple-touch-icon", href: "/dash-icon-tab-v5.png?v=5" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&family=Manrope:wght@400;500;600;700;800&family=Plus+Jakarta+Sans:wght@600;700;800&family=Sora:wght@500;600;700;800&display=swap",
      },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="id">
      <head>
        <HeadContent />
      </head>
      <body>
        <AnalyticsProvider>
          {children}
        </AnalyticsProvider>
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <I18nProvider>
          <Outlet />
          <Toaster position="top-right" richColors />
          <ConfirmHost />
        </I18nProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

"use client";

/**
 * Navigation wrappers that auto-merge `PRESERVED_QUERY_PARAMS` (e.g.
 * `coder_session_token`) into every in-app navigation. Use `useAppRouter`
 * and `AppLink` instead of `useRouter` / `<Link>` from `next/*` so the
 * preserved keys ride along to every destination URL.
 *
 * The destination URL always wins — if the caller explicitly sets a
 * preserved key on the target URL, it's not overwritten.
 *
 * Static-render compatibility:
 * - `useAppRouter` reads `window.location.search` lazily inside
 *   push/replace/prefetch (only ever called on the client). It does not
 *   call `useSearchParams`, so it does not force a static-render bailout
 *   on pages that only use programmatic navigation.
 * - `AppLink` does need params at render time to compute `href`. The
 *   `useSearchParams` call is isolated in an inner component wrapped in
 *   `Suspense`, so the bailout is scoped to one Link rather than the
 *   whole route.
 */

import * as React from "react";
import NextLink, { type LinkProps } from "next/link";
import {
  useRouter as useNextRouter,
  useSearchParams,
  type ReadonlyURLSearchParams,
} from "next/navigation";
import { PRESERVED_QUERY_PARAMS } from "./constants";

type Href = LinkProps["href"];

const PLACEHOLDER_BASE = "http://_xo_placeholder_";

function isAbsoluteOrSpecial(href: string): boolean {
  if (!href) return true;
  if (href.startsWith("#")) return true;
  if (href.startsWith("mailto:") || href.startsWith("tel:")) return true;
  if (href.startsWith("//")) return true;
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(href);
}

export function withPreservedParams(
  href: Href,
  current: ReadonlyURLSearchParams | URLSearchParams | null,
): Href {
  if (!current) return href;

  if (typeof href === "string") {
    if (isAbsoluteOrSpecial(href)) return href;
    let url: URL;
    try {
      url = new URL(href, PLACEHOLDER_BASE);
    } catch {
      return href;
    }
    const dest = url.searchParams;
    let changed = false;
    for (const key of PRESERVED_QUERY_PARAMS) {
      if (dest.has(key)) continue;
      const value = current.get(key);
      if (value !== null) {
        dest.set(key, value);
        changed = true;
      }
    }
    if (!changed) return href;
    return `${url.pathname}${url.search}${url.hash}`;
  }

  if (href.protocol || href.host || href.hostname) return href;
  type QueryValue = string | number | boolean | readonly string[] | null | undefined;
  const baseQuery: Record<string, QueryValue> =
    typeof href.query === "string"
      ? (Object.fromEntries(new URLSearchParams(href.query)) as Record<string, string>)
      : { ...((href.query as Record<string, QueryValue>) ?? {}) };

  let changed = false;
  for (const key of PRESERVED_QUERY_PARAMS) {
    const existing = baseQuery[key];
    if (existing !== undefined && existing !== null && existing !== "") continue;
    const value = current.get(key);
    if (value !== null) {
      baseQuery[key] = value;
      changed = true;
    }
  }
  if (!changed) return href;
  return { ...href, query: baseQuery };
}

function getCurrentSearchParams(): URLSearchParams | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search);
}

type NextRouter = ReturnType<typeof useNextRouter>;

export function useAppRouter(): NextRouter {
  const router = useNextRouter();

  return React.useMemo<NextRouter>(
    () => ({
      push: (href, options) =>
        router.push(
          withPreservedParams(href, getCurrentSearchParams()) as string,
          options,
        ),
      replace: (href, options) =>
        router.replace(
          withPreservedParams(href, getCurrentSearchParams()) as string,
          options,
        ),
      back: () => router.back(),
      forward: () => router.forward(),
      refresh: () => router.refresh(),
      prefetch: (href, options) =>
        router.prefetch(
          withPreservedParams(href, getCurrentSearchParams()) as string,
          options,
        ),
    }),
    [router],
  );
}

type AppLinkProps = React.ComponentPropsWithoutRef<typeof NextLink>;

const PreservingLink = React.forwardRef<HTMLAnchorElement, AppLinkProps>(
  function PreservingLink({ href, ...rest }, ref) {
    const searchParams = useSearchParams();
    const finalHref = withPreservedParams(href, searchParams);
    return <NextLink href={finalHref} ref={ref} {...rest} />;
  },
);
PreservingLink.displayName = "PreservingLink";

export const AppLink = React.forwardRef<HTMLAnchorElement, AppLinkProps>(
  function AppLink(props, ref) {
    return (
      <React.Suspense fallback={<NextLink {...props} ref={ref} />}>
        <PreservingLink {...props} ref={ref} />
      </React.Suspense>
    );
  },
);
AppLink.displayName = "AppLink";

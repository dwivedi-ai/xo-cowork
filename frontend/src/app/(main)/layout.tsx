import MainShell from "./main-shell";

/**
 * (main) layout — server component shell.
 *
 * By keeping this file free of "use client", Next.js can:
 *  1. Stream the outer HTML frame before the client JS loads.
 *  2. Code-split the heavy <MainShell> client island (framer-motion,
 *     Zustand stores, react-i18next, etc.) into its own chunk that
 *     loads in parallel with page-level code.
 *
 * All interactive logic lives in <MainShell>.
 */
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return <MainShell>{children}</MainShell>;
}

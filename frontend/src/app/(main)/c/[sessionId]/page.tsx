import { Suspense } from "react";
import { SessionPageClient } from "./session-page-client";

// Server mode: render on demand. Desktop static export uses a different
// build (see next.config.ts) and is out of scope here.
export const dynamic = "force-dynamic";

export async function generateStaticParams() {
  return [];
}

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return (
    <Suspense fallback={null}>
      <SessionPageClient sessionId={sessionId} />
    </Suspense>
  );
}

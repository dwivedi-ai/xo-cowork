import { Suspense } from "react";
import SettingsPageClient from "@/components/settings/settings-layout";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <SettingsPageClient />
    </Suspense>
  );
}

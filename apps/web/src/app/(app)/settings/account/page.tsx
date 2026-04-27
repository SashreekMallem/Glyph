import { redirect } from "next/navigation";
import { FadeInUp, Stagger, StaggerChild } from "@/components/motion/primitives";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const createdAt = user.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "Unknown";

  return (
    <div>
      <FadeInUp className="mb-6">
        <h1 className="font-serif text-2xl tracking-tight text-neutral-900">
          Account
        </h1>
        <p className="mt-1 text-sm text-neutral-500">
          View your account details and sign out.
        </p>
      </FadeInUp>

      <Stagger className="flex flex-col gap-6">
        <StaggerChild>
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>
                These details come from your authentication provider.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-500">
                  Email
                </div>
                <div className="mt-1 text-sm text-neutral-900">
                  {user.email ?? "—"}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-500">
                  User ID
                </div>
                <div className="mt-1 break-all font-mono text-xs text-neutral-700">
                  {user.id}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-[0.14em] text-neutral-500">
                  Account created
                </div>
                <div className="mt-1 text-sm text-neutral-900">{createdAt}</div>
              </div>
            </CardContent>
          </Card>
        </StaggerChild>

        <StaggerChild>
          <Card>
            <CardHeader>
              <CardTitle>Sign out</CardTitle>
              <CardDescription>
                End your session on this device.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action="/auth/sign-out" method="post">
                <Button type="submit" variant="destructive">
                  Sign out
                </Button>
              </form>
            </CardContent>
          </Card>
        </StaggerChild>
      </Stagger>
    </div>
  );
}

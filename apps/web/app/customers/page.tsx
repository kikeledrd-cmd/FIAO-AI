import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AuthRepository } from "@fiao/database";
import { AppShell } from "@/components/app-shell";
import { CustomersScreen } from "@/features/customers/customers-screen";
import { ACTIVE_BRANCH_COOKIE_NAME, requireSession } from "@/lib/session/current-session";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  let session;
  try {
    session = await requireSession();
  } catch {
    redirect("/login");
  }

  const repository = new AuthRepository();
  const context = await repository.findUserContext(session.userId, session.ownerId);
  if (!context) redirect("/login");

  const cookieStore = await cookies();
  const requestedBranch = cookieStore.get(ACTIVE_BRANCH_COOKIE_NAME)?.value;
  const activeBranch =
    context.branches.find((branch) => branch.id === requestedBranch) ?? context.branches[0];
  if (!activeBranch) redirect("/login");

  return (
    <AppShell
      user={{ ...context.user, ownerId: session.ownerId, deviceId: session.deviceId }}
      branches={context.branches}
      activeBranchId={activeBranch.id}
    >
      <CustomersScreen />
    </AppShell>
  );
}

import SessionWorkspaceShell from "@/components/session-workspace-shell";
import SessionsWorkspace from "@/components/sessions-workspace";

export default function SessionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SessionWorkspaceShell calendar={<SessionsWorkspace />}>
      {children}
    </SessionWorkspaceShell>
  );
}

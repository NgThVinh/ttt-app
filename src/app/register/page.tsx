import AuthPage from "@/components/auth-page";
export const metadata = { title: "Đăng ký" };
export default async function Register({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <AuthPage mode="register" params={await searchParams} />;
}

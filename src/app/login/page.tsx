import { signIn } from "@/lib/auth/actions";
import { LoginSubmitButton } from "./login-submit-button";
import Image from "next/image";
type LoginPageProps = {
  searchParams: Promise<{ error?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error } = await searchParams;
  const errorMessage = Array.isArray(error) ? error[0] : error;

  return (
    <main className="grid min-h-screen place-items-center bg-slate-50 px-5 py-10">
      <section className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-8">
        <div className="mb-8 text-center">
 
          <div className="mx-auto w-40" ><Image
  src="/logo.png"
  alt="TAYO"
  width={550}
  height={303}
  className="h-auto w-full"
  priority
/></div>
          
          <p className="mt-2 text-sm text-slate-500">השתמשו באימייל העבודה כדי להיכנס למערכת.</p>
        </div>

        <form action={signIn} className="space-y-5">
          <label className="block text-sm font-medium text-slate-700">
            אימייל
            <input name="email" type="email" autoComplete="email" required className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-950 outline-none transition focus:border-black focus:ring-3 focus:ring-slate-200" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            סיסמה
            <input name="password" type="password" autoComplete="current-password" required className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-950 outline-none transition focus:border-black focus:ring-3 focus:ring-slate-200" />
          </label>
          {errorMessage ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{errorMessage}</p> : null}
          <LoginSubmitButton />
        </form>
      </section>
    </main>
  );
}

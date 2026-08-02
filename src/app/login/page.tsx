import { signIn } from "@/lib/auth/actions";

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
          <div className="mx-auto grid size-10 place-items-center rounded-xl bg-indigo-600 text-base font-bold text-white">T</div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight text-slate-950">Sign in to Tayo Bar</h1>
          <p className="mt-2 text-sm text-slate-500">Use your work email to access the ERP.</p>
        </div>

        <form action={signIn} className="space-y-5">
          <label className="block text-sm font-medium text-slate-700">
            Email
            <input name="email" type="email" autoComplete="email" required className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-3 focus:ring-indigo-100" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Password
            <input name="password" type="password" autoComplete="current-password" required className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-3 focus:ring-indigo-100" />
          </label>
          {errorMessage ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700">{errorMessage}</p> : null}
          <button type="submit" className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-3 focus:ring-indigo-200">Sign in</button>
        </form>
      </section>
    </main>
  );
}

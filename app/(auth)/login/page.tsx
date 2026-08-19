"use client";

import { useActionState } from "react";
import { login } from "@/lib/auth";
import { LogoTile } from "@/components/brand/Logo";

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(login, null);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 selection:bg-blue-100 p-6">
      <div className="max-w-md w-full space-y-8 p-8 bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100">
        <div className="text-center">
            <LogoTile className="w-14 h-14 shadow-lg shadow-blue-200 mb-4" label="MINS CCTV" />
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-950">
            Login Admin
          </h2>
          <p className="mt-2 text-sm font-medium text-slate-500">
            Masuk ke sistem monitoring CCTV
          </p>
        </div>

        <form action={formAction} className="mt-8 space-y-6">
          <div className="space-y-4">
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-bold text-slate-700 ml-1 mb-1"
              >
                Username
              </label>
              <input
                id="username"
                name="username"
                type="text"
                required
                autoComplete="username"
                className="block w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                placeholder="Masukkan username"
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-bold text-slate-700 ml-1 mb-1"
              >
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="current-password"
                className="block w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-medium"
                placeholder="••••••••"
              />
            </div>
          </div>

          {state?.error && (
            <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl text-sm font-semibold flex items-center gap-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"></path></svg>
              {state.error}
            </div>
          )}

          <button
            type="submit"
            disabled={isPending}
            className="w-full flex justify-center py-3.5 px-4 border border-transparent rounded-xl shadow-lg shadow-blue-200 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isPending ? (
                 <div className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                    <span>Memproses...</span>
                 </div>
            ) : "Masuk Sekarang"}
          </button>
        </form>
      </div>
    </div>
  );
}

"use client";

import React, { useActionState, useState } from "react";
import { Lock, Eye, EyeOff, ArrowRight, ShieldCheck, AlertCircle, Loader2 } from "lucide-react";
import { loginAction, LoginState } from "./actions";

export default function LoginPage() {
  const [state, formAction, isPending] = useActionState(loginAction, null);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 selection:bg-blue-500 selection:text-white">
      {/* Background radial glow */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(59,130,246,0.06)_0%,transparent_70%)] pointer-events-none" />

      <div className="w-full max-w-sm relative z-10">
        {/* Card Container */}
        <div className="bg-slate-900/70 border border-slate-800 backdrop-blur-xl rounded-2xl p-6 sm:p-8 shadow-2xl shadow-black/60">
          {/* Header */}
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-blue-600/10 border border-blue-500/20 text-blue-400 mx-auto flex items-center justify-center mb-3">
              <Lock className="w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              MarketReader
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Inserisci la password per accedere alla piattaforma
            </p>
          </div>

          {/* Form */}
          <form action={formAction} className="space-y-4">
            {/* Error Message */}
            {state?.error && (
              <div className="p-3 rounded-lg bg-red-950/40 border border-red-500/30 flex items-start gap-2.5 text-xs text-red-300 animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{state.error}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium text-slate-300 mb-1.5"
              >
                Password di Accesso
              </label>
              <div className="relative">
                <input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoFocus
                  required
                  placeholder="••••••••••••"
                  className="w-full px-3.5 py-2.5 bg-slate-950/80 border border-slate-700 rounded-lg text-sm text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isPending}
              className="w-full py-2.5 px-4 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-blue-600/20"
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifica in corso...</span>
                </>
              ) : (
                <>
                  <span>Accedi</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Footer note */}
          <div className="mt-6 pt-4 border-t border-slate-800/80 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
            <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
            <span>Sessione protetta con cookie sicuro (30 giorni)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

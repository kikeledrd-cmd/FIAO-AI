import { BrandLogo } from "@/components/brand-logo";
import { LoginForm } from "@/features/auth/login-form";
import { FIAO_BRAND } from "@/lib/branding";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <BrandLogo size={150} />
        </div>
        <p className="login-tagline">{FIAO_BRAND.tagline}</p>
        <h1 className="login-title">Tu colmado, bajo control.</h1>
        <p className="login-subtitle">Entra con tu teléfono y PIN.</p>
        <LoginForm />
      </section>
    </main>
  );
}

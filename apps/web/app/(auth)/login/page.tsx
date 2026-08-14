import { LoginForm } from "@/features/auth/login-form";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section>
        <p>FIAO</p>
        <h1>Tu colmado, bajo control.</h1>
        <p>Entra con tu teléfono y PIN.</p>
        <LoginForm />
      </section>
    </main>
  );
}

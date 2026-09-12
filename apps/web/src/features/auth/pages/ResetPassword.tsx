import resetImg from '@/assets/reset.png';
import AuthLayout from '@/features/auth/components/AuthLayout';
import ResetPasswordForm from '@/features/auth/components/ResetPasswordForm';

export default function ResetPassword() {
  return (
    <AuthLayout
      title="Changer le mot de passe"
      subtitle="Saisissez votre adresse email pour réinitialiser votre mot de passe"
      decorativeImage={resetImg}
    >
      <ResetPasswordForm />
    </AuthLayout>
  );
}

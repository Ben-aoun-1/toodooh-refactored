

import resetImg from '../../../assets/reset.png';
import AuthLayout from '../components/AuthLayout';
import ResetPasswordForm from '../components/ResetPasswordForm';

export default function ResetPassword() {
  return (
    <AuthLayout
      title="Changer le mot de passe"
      subtitle="Saisissez votre adresse email pour générer un mot de passe"
      decorativeImage={resetImg}
    >
      <ResetPasswordForm />
    </AuthLayout>
  );
}

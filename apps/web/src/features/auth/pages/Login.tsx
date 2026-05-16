

import AuthLayout from '@/features/auth/components/AuthLayout';
import LoginForm from '@/features/auth/components/LoginForm';

export default function Login() {
  return (
    <AuthLayout
      title="Connexion"
      subtitle="Connectez-vous à votre compte professionnel"
      noContainer={true}
    >
      <LoginForm />
    </AuthLayout>
  );
}

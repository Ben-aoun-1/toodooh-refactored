

import AuthLayout from '../../components/auth/AuthLayout';
import LoginForm from '../../components/auth/LoginForm';

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

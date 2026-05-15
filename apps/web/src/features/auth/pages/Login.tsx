

import AuthLayout from '../components/AuthLayout';
import LoginForm from '../components/LoginForm';

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

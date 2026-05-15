

import AuthLayout from '../components/AuthLayout';
import UpdatePasswordForm from '../components/UpdatePasswordForm';

export default function UpdatePassword() {
  return (
    <AuthLayout title="Nouveau mot de passe" subtitle="Choisissez un nouveau mot de passe sécurisé">
      <UpdatePasswordForm />
    </AuthLayout>
  );
}

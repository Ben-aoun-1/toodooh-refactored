

import AuthLayout from '@/features/auth/components/AuthLayout';
import UpdatePasswordForm from '@/features/auth/components/UpdatePasswordForm';

export default function UpdatePassword() {
  return (
    <AuthLayout title="Nouveau mot de passe" subtitle="Choisissez un nouveau mot de passe sécurisé">
      <UpdatePasswordForm />
    </AuthLayout>
  );
}

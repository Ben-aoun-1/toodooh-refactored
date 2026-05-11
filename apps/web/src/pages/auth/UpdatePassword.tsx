import React from 'react';
import AuthLayout from '../../components/auth/AuthLayout';
import UpdatePasswordForm from '../../components/auth/UpdatePasswordForm';

export default function UpdatePassword() {
  return (
    <AuthLayout title="Nouveau mot de passe" subtitle="Choisissez un nouveau mot de passe sécurisé">
      <UpdatePasswordForm />
    </AuthLayout>
  );
}

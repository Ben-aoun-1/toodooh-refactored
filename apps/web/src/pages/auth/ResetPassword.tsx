import React from 'react';
import AuthLayout from '../../components/auth/AuthLayout';
import ResetPasswordForm from '../../components/auth/ResetPasswordForm';
import resetImg from '../../assets/reset.png';

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
// Utilitaire pour nettoyer complètement le cache d'authentification
// Utilisez ceci si vous avez des problèmes de chargement infini

export const clearAuthCache = () => {
  console.log('🧹 Clearing all auth cache...');
  
  // Nettoyer le localStorage
  localStorage.removeItem('onboardingCompleted');
  localStorage.removeItem('justOnboarded');
  localStorage.removeItem('user_profile_type');
  localStorage.removeItem('user_raison_social');
  localStorage.removeItem('user_validation_status');
  localStorage.removeItem('admin-storage');
  
  // Nettoyer le sessionStorage
  sessionStorage.clear();
  
  console.log('✅ Auth cache cleared');
  
  // Recharger la page
  window.location.href = '/login';
};

// Fonction à appeler depuis la console du navigateur pour déboguer
if (typeof window !== 'undefined') {
  (window as any).clearAuthCache = clearAuthCache;
  console.log('💡 Utilitaire chargé: window.clearAuthCache()');
}













































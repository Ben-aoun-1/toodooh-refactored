import { supabase } from '../lib/supabase';

// Script pour vérifier la structure des tables admin
export async function checkTableStructure() {
  try {
    console.log('=== VÉRIFICATION DE LA STRUCTURE DES TABLES ===');

    // 1. Vérifier la structure de admin_permissions
    console.log('\n1. Structure de admin_permissions:');
    const { data: permissionsStructure, error: permissionsError } = await supabase
      .from('admin_permissions')
      .select('*')
      .limit(1);

    if (permissionsError) {
      console.error('Erreur admin_permissions:', permissionsError);
    } else {
      console.log(
        'Colonnes admin_permissions:',
        permissionsStructure.length > 0 ? Object.keys(permissionsStructure[0]) : 'Table vide',
      );
      console.log('Données admin_permissions:', permissionsStructure);
    }

    // 2. Vérifier la structure de admin_roles
    console.log('\n2. Structure de admin_roles:');
    const { data: rolesStructure, error: rolesError } = await supabase
      .from('admin_roles')
      .select('*')
      .limit(1);

    if (rolesError) {
      console.error('Erreur admin_roles:', rolesError);
    } else {
      console.log(
        'Colonnes admin_roles:',
        rolesStructure.length > 0 ? Object.keys(rolesStructure[0]) : 'Table vide',
      );
      console.log('Données admin_roles:', rolesStructure);
    }

    // 3. Vérifier si admin_profiles existe
    console.log('\n3. Test admin_profiles:');
    const { data: profilesStructure, error: profilesError } = await supabase
      .from('admin_profiles')
      .select('*')
      .limit(1);

    if (profilesError) {
      console.error("admin_profiles n'existe pas ou erreur:", profilesError);
    } else {
      console.log(
        'Colonnes admin_profiles:',
        profilesStructure.length > 0 ? Object.keys(profilesStructure[0]) : 'Table vide',
      );
      console.log('Données admin_profiles:', profilesStructure);
    }

    // 4. Vérifier si admin_activities existe
    console.log('\n4. Test admin_activities:');
    const { data: activitiesStructure, error: activitiesError } = await supabase
      .from('admin_activities')
      .select('*')
      .limit(1);

    if (activitiesError) {
      console.error("admin_activities n'existe pas ou erreur:", activitiesError);
    } else {
      console.log(
        'Colonnes admin_activities:',
        activitiesStructure.length > 0 ? Object.keys(activitiesStructure[0]) : 'Table vide',
      );
      console.log('Données admin_activities:', activitiesStructure);
    }

    console.log('\n=== FIN DE LA VÉRIFICATION ===');
  } catch (error) {
    console.error('Erreur générale:', error);
  }
}

// Exécuter le test si appelé directement
if (typeof window !== 'undefined') {
  checkTableStructure();
}

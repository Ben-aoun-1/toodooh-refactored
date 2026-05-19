-- =====================================================
-- REQUÊTES POUR VÉRIFIER ET METTRE À JOUR LES TABLES ADMIN
-- =====================================================

-- 1. VÉRIFIER LA STRUCTURE DE admin_permissions
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'admin_permissions' 
ORDER BY ordinal_position;

-- 2. VÉRIFIER LA STRUCTURE DE admin_roles  
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'admin_roles' 
ORDER BY ordinal_position;

-- 3. VÉRIFIER SI admin_profiles EXISTE
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'admin_profiles' 
ORDER BY ordinal_position;

-- 4. VÉRIFIER SI admin_activities EXISTE
SELECT column_name, data_type, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'admin_activities' 
ORDER BY ordinal_position;

-- =====================================================
-- REQUÊTES DE MISE À JOUR (à exécuter selon les résultats)
-- =====================================================

-- Si admin_permissions manque des colonnes, les ajouter :
ALTER TABLE admin_permissions 
ADD COLUMN IF NOT EXISTS resource VARCHAR(50),
ADD COLUMN IF NOT EXISTS action VARCHAR(50),
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Si admin_roles manque des colonnes, les ajouter :
ALTER TABLE admin_roles 
ADD COLUMN IF NOT EXISTS permissions TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS is_system_role BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- Créer admin_profiles si elle n'existe pas :
CREATE TABLE IF NOT EXISTS admin_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL UNIQUE,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('superadmin', 'admin', 'moderator')),
  permissions TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES admin_profiles(id)
);

-- Créer admin_activities si elle n'existe pas :
CREATE TABLE IF NOT EXISTS admin_activities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_id UUID REFERENCES admin_profiles(id) ON DELETE CASCADE,
  admin_name VARCHAR(200) NOT NULL,
  action VARCHAR(100) NOT NULL,
  resource VARCHAR(100) NOT NULL,
  resource_id UUID,
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Ajouter les index pour les performances :
CREATE INDEX IF NOT EXISTS idx_admin_profiles_user_id ON admin_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_profiles_email ON admin_profiles(email);
CREATE INDEX IF NOT EXISTS idx_admin_profiles_role ON admin_profiles(role);
CREATE INDEX IF NOT EXISTS idx_admin_profiles_active ON admin_profiles(is_active);

CREATE INDEX IF NOT EXISTS idx_admin_activities_admin_id ON admin_activities(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_activities_created_at ON admin_activities(created_at);
CREATE INDEX IF NOT EXISTS idx_admin_activities_resource ON admin_activities(resource);

-- Fonction pour mettre à jour updated_at automatiquement :
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers pour updated_at :
CREATE TRIGGER update_admin_profiles_updated_at 
  BEFORE UPDATE ON admin_profiles 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_admin_roles_updated_at 
  BEFORE UPDATE ON admin_roles 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_admin_permissions_updated_at 
  BEFORE UPDATE ON admin_permissions 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insérer les permissions de base si elles n'existent pas :
INSERT INTO admin_permissions (name, description, resource, action) VALUES
('users.read', 'Lire les utilisateurs', 'users', 'read'),
('users.write', 'Modifier les utilisateurs', 'users', 'write'),
('users.delete', 'Supprimer les utilisateurs', 'users', 'delete'),
('screens.read', 'Lire les écrans', 'screens', 'read'),
('screens.write', 'Modifier les écrans', 'screens', 'write'),
('screens.delete', 'Supprimer les écrans', 'screens', 'delete'),
('campaigns.read', 'Lire les campagnes', 'campaigns', 'read'),
('campaigns.write', 'Modifier les campagnes', 'campaigns', 'write'),
('campaigns.delete', 'Supprimer les campagnes', 'campaigns', 'delete'),
('verifications.read', 'Lire les vérifications', 'verifications', 'read'),
('verifications.write', 'Traiter les vérifications', 'verifications', 'write'),
('reports.read', 'Lire les rapports', 'reports', 'read'),
('admins.read', 'Lire les administrateurs', 'admins', 'read'),
('admins.write', 'Modifier les administrateurs', 'admins', 'write'),
('admins.delete', 'Supprimer les administrateurs', 'admins', 'delete')
ON CONFLICT (name) DO NOTHING;

-- Insérer les rôles de base si ils n'existent pas :
INSERT INTO admin_roles (name, description, permissions, is_system_role) VALUES
('superadmin', 'Super administrateur avec tous les droits', ARRAY['*'], true),
('admin', 'Administrateur avec droits étendus', ARRAY['users.read', 'users.write', 'screens.read', 'screens.write', 'campaigns.read', 'campaigns.write', 'verifications.read', 'verifications.write', 'reports.read'], false),
('moderator', 'Modérateur avec droits limités', ARRAY['users.read', 'screens.read', 'campaigns.read', 'campaigns.write'], false)
ON CONFLICT (name) DO NOTHING;













































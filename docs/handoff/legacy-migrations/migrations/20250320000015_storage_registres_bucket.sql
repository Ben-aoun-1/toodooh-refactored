-- Bucket "registres" pour logos et documents (RNE, CIN, etc.)
-- Sans politique RLS, l'upload renvoie "new row violates row-level security policy".

INSERT INTO storage.buckets (id, name, public)
VALUES ('registres', 'registres', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Policy : upload pour utilisateurs authentifiés (logos, documents)
CREATE POLICY "registres: upload pour authentifiés"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'registres');

-- Policy : lecture pour utilisateurs authentifiés (leurs fichiers)
CREATE POLICY "registres: lecture pour authentifiés"
ON storage.objects
FOR SELECT
TO authenticated
USING (bucket_id = 'registres');

-- Policy : mise à jour / suppression pour authentifiés
CREATE POLICY "registres: update pour authentifiés"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'registres')
WITH CHECK (bucket_id = 'registres');

CREATE POLICY "registres: delete pour authentifiés"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'registres');

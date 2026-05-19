-- Bucket Storage pour les images des événements (back-office)
-- Lecture publique pour affichage sur le dashboard annonceur.

-- Créer le bucket "event-images" (public pour URL publique)
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-images', 'event-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Policy : permettre l'upload aux utilisateurs authentifiés (admin)
CREATE POLICY "event-images: upload pour authentifiés"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'event-images');

-- Policy : lecture publique des images (affichage dashboard)
CREATE POLICY "event-images: lecture publique"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'event-images');

-- Policy : suppression/mise à jour pour authentifiés (optionnel)
CREATE POLICY "event-images: update/delete pour authentifiés"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'event-images')
WITH CHECK (bucket_id = 'event-images');

CREATE POLICY "event-images: delete pour authentifiés"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'event-images');

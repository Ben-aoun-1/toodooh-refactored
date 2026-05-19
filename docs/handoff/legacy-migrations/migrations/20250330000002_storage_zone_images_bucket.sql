-- Bucket Storage pour les images des zones prédéfinies (admin)
INSERT INTO storage.buckets (id, name, public)
VALUES ('zone-images', 'zone-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE POLICY "zone-images: upload pour authentifiés"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'zone-images');

CREATE POLICY "zone-images: lecture publique"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'zone-images');

CREATE POLICY "zone-images: update pour authentifiés"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'zone-images') WITH CHECK (bucket_id = 'zone-images');

CREATE POLICY "zone-images: delete pour authentifiés"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'zone-images');

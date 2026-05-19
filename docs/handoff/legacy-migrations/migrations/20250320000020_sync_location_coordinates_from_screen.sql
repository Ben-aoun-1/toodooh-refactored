-- =====================================================
-- Règle 2 : quand un écran est ajouté à une localité (ou ses
-- coordonnées changent), recopier les coordonnées GPS de l'écran
-- dans la localité pour affichage sur la carte.
-- =====================================================

CREATE OR REPLACE FUNCTION sync_location_coordinates_from_screen()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.location_id IS NOT NULL AND NEW.coordinates IS NOT NULL THEN
    UPDATE locations
    SET coordinates = NEW.coordinates,
        updated_at = NOW()
    WHERE id = NEW.location_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS sync_location_coordinates_trigger ON screens;
CREATE TRIGGER sync_location_coordinates_trigger
  AFTER INSERT OR UPDATE OF location_id, coordinates
  ON screens
  FOR EACH ROW
  EXECUTE FUNCTION sync_location_coordinates_from_screen();

COMMENT ON FUNCTION sync_location_coordinates_from_screen() IS 'Copie les coordonnées de l''écran vers sa localité à chaque liaison ou mise à jour des coords';

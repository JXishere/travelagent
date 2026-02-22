-- Backfill lat/lng for spots missing coordinates using the area centroid
-- (average of already-geocoded spots in the same area).
-- Area-level precision is sufficient for distance labeling ("~2km from SS2").
UPDATE spots s
SET
  latitude  = sub.avg_lat,
  longitude = sub.avg_lng
FROM (
  SELECT
    area,
    AVG(latitude)  AS avg_lat,
    AVG(longitude) AS avg_lng
  FROM spots
  WHERE latitude  IS NOT NULL
    AND longitude IS NOT NULL
    AND area      IS NOT NULL
  GROUP BY area
) sub
WHERE s.area      = sub.area
  AND s.latitude  IS NULL
  AND s.longitude IS NULL;

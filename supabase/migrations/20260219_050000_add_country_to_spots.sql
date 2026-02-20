alter table spots add column country text;

-- Backfill from known city mappings
update spots set country = case city
  when 'Kuala Lumpur'    then 'Malaysia'
  when 'Petaling Jaya'   then 'Malaysia'
  when 'Penang'          then 'Malaysia'
  when 'Klang'           then 'Malaysia'
  when 'Malacca'         then 'Malaysia'
  when 'Johor Bahru'     then 'Malaysia'
  when 'Ipoh'            then 'Malaysia'
  when 'Langkawi'        then 'Malaysia'
  when 'Taipei'          then 'Taiwan'
  else city  -- safe fallback: unknown cities keep city name until corrected
end;

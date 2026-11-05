-- The division's schools, in the database.
--
-- The list used to live in `src/sbfp-app.tsx` (INIT_ES / INIT_HS). It is data,
-- not code: the Division Office can rename a school or add a newly opened one
-- without a redeploy, and both sites read the same rows.
--
-- `id` is the key every other table already stores in `school_id`
-- (`sbfp_accounts`, `sbfp_records`, `sbfp_feedback`, `sbfp_school_profiles`),
-- so it is stable and never changes — a rename only touches `name`.
create table if not exists sbfp_schools (
  id text primary key,
  name text not null,
  type text not null default 'Elementary' check (type in ('Elementary', 'High School')),
  -- Display order inside a type (the DepEd district listing order).
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sbfp_schools_name_uniq
  on sbfp_schools (lower(name), type);

-- One row per school keeps working if the same campus teaches both levels
-- (e.g. an integrated school listed as an elementary and a high school), which
-- is why the uniqueness above is on (name, type) and not on name alone.
insert into sbfp_schools (id, name, type, sort_order) values
  ('es01', 'Anonas East Elementary School', 'Elementary', 1),
  ('es02', 'Anonas Elementary School', 'Elementary', 2),
  ('es03', 'Bactad Community School', 'Elementary', 3),
  ('es04', 'Bactad East Elementary School', 'Elementary', 4),
  ('es05', 'Badipa Elementary School', 'Elementary', 5),
  ('es06', 'Bolaoen Elementary School', 'Elementary', 6),
  ('es07', 'Cabaruan Elementary School', 'Elementary', 7),
  ('es08', 'Cabuloan Elementary School', 'Elementary', 8),
  ('es09', 'Calegu Integrated School', 'Elementary', 9),
  ('es10', 'Camanang Elementary School', 'Elementary', 10),
  ('es11', 'Camantiles Elementary School', 'Elementary', 11),
  ('es12', 'Casabula Elementary School', 'Elementary', 12),
  ('es13', 'Catablan Integrated School', 'Elementary', 13),
  ('es14', 'Cayambanan Elementary School', 'Elementary', 14),
  ('es15', 'Consolacion Elementary School', 'Elementary', 15),
  ('es16', 'Don Alipio Fernandez, Sr. Integrated School', 'Elementary', 16),
  ('es17', 'Don Amadeo Perez, Sr. Memorial Central School - East', 'Elementary', 17),
  ('es18', 'Don Amadeo Perez, Sr. Memorial Central School - Main', 'Elementary', 18),
  ('es19', 'Don Amadeo Perez, Sr. Memorial Central School - West', 'Elementary', 19),
  ('es20', 'Don Andres G. Maiquez Memorial Elementary School', 'Elementary', 20),
  ('es21', 'Don Clemente Blanco Memorial Elementary School', 'Elementary', 21),
  ('es22', 'Don Felipe Maramba Elementary School', 'Elementary', 22),
  ('es23', 'Don Valentin M. Ordoñez Memorial School', 'Elementary', 23),
  ('es24', 'F. B. Goce Community School', 'Elementary', 24),
  ('es25', 'Labit East Elementary School', 'Elementary', 25),
  ('es26', 'Labit West Elementary School', 'Elementary', 26),
  ('es27', 'Lananpin Elementary School', 'Elementary', 27),
  ('es28', 'Lazaga Elementary School', 'Elementary', 28),
  ('es29', 'Manan Elementary School', 'Elementary', 29),
  ('es30', 'Nanbacuran Elementary School', 'Elementary', 30),
  ('es31', 'Nancalobasaan Elementary School', 'Elementary', 31),
  ('es32', 'Nancalobasaan Riverside Integrated School', 'Elementary', 32),
  ('es33', 'Nancayasan Elementary School', 'Elementary', 33),
  ('es34', 'Oltama Elementary School', 'Elementary', 34),
  ('es35', 'Palina East Elementary School', 'Elementary', 35),
  ('es36', 'Pinmaludpod Elementary School', 'Elementary', 36),
  ('es37', 'San Jose Elementary School', 'Elementary', 37),
  ('es38', 'San Jose Leet Integrated School', 'Elementary', 38),
  ('es39', 'Santa Lucia Elementary School', 'Elementary', 39),
  ('es40', 'Tabuyoc Elementary School', 'Elementary', 40),
  ('es41', 'Tiposu Elementary School', 'Elementary', 41),
  ('es42', 'Trinidad S. Perez Elementary School', 'Elementary', 42),
  ('es43', 'Tulong Integrated School', 'Elementary', 43),
  ('es44', 'Urdaneta I Central School', 'Elementary', 44),
  ('es45', 'Vicente Taaca Memorial School', 'Elementary', 45),
  ('hs01', 'Anonas National High School', 'High School', 1),
  ('hs02', 'Bactad East National High School', 'High School', 2),
  ('hs03', 'Badipa National High School', 'High School', 3),
  ('hs04', 'Cabaruan National High School', 'High School', 4),
  ('hs05', 'Cabuloan National High School', 'High School', 5),
  ('hs06', 'Camantiles National High School', 'High School', 6),
  ('hs07', 'Catablan Integrated School', 'High School', 7),
  ('hs08', 'Don Mariano Q. Umipig National High School', 'High School', 8),
  ('hs09', 'Labit National High School', 'High School', 9),
  ('hs10', 'Lananpin National High School', 'High School', 10),
  ('hs11', 'Palina East National High School', 'High School', 11),
  ('hs12', 'Pedro T. Orata National High School', 'High School', 12),
  ('hs13', 'Urdaneta City National High School', 'High School', 13)
on conflict (id) do nothing;

/** The tables the interactive examples use, created by `init` in `app/pglite.config.ts`. */
export const TODOS_SQL = /* sql */ `
  CREATE TABLE IF NOT EXISTS todos (
    id serial PRIMARY KEY,
    title text NOT NULL,
    done boolean NOT NULL DEFAULT false
  );
`

export const PLANETS_SQL = /* sql */ `
  CREATE TABLE IF NOT EXISTS planets (
    id serial PRIMARY KEY,
    name text NOT NULL UNIQUE,
    moons int NOT NULL,
    radius_km int NOT NULL
  );
  INSERT INTO planets (name, moons, radius_km) VALUES
    ('Mercury', 0, 2440), ('Venus', 0, 6052), ('Earth', 1, 6371), ('Mars', 2, 3390),
    ('Jupiter', 95, 69911), ('Saturn', 146, 58232), ('Uranus', 28, 25362), ('Neptune', 16, 24622)
  ON CONFLICT (name) DO NOTHING;
`

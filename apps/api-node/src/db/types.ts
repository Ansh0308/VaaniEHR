// Type parsers for the pg driver, applied once on import (process-wide).
// `date` columns stay plain 'YYYY-MM-DD' strings (no time-zone shift, like ClinicOS DATEONLY);
// bigint (seq, counts) becomes a JS number (values here never approach 2^53).
// Import this module from anything that creates its own pg pool or client (scripts, tests).
import pg from 'pg';

pg.types.setTypeParser(1082, (value) => value);
pg.types.setTypeParser(20, (value) => Number(value));

USE iims_school_system;

INSERT INTO institutions
  (institution_name, institution_code, email, phone, county, sub_county, location, village)
VALUES
  ("Default Institution", "DEFAULT", "admin@school.local", "+254700000000", "N/A", "N/A", "N/A", "N/A")
ON DUPLICATE KEY UPDATE institution_name = VALUES(institution_name);

-- NOTE:
-- Default admin user is auto-created by src/server.js using:
-- username: admin
-- password: 1234
-- You can change those values in .env after first login.

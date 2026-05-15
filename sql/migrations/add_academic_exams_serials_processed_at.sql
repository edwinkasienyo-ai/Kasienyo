-- Idempotent hint migration; live servers also auto-add this column in src/server.js on startup.
ALTER TABLE academic_exams
  ADD COLUMN serials_processed_at DATETIME NULL AFTER teacher_exam_supplement;

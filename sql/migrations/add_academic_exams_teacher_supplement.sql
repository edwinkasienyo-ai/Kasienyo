-- Optional teacher-only pack (MCQ key, annex, layout notes); learner-facing text stays clean in generated_exam_text.
ALTER TABLE academic_exams
  ADD COLUMN teacher_exam_supplement LONGTEXT NULL AFTER generated_exam_text;

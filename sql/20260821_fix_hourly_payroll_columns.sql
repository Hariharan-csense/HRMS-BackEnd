-- Fix for: Unknown column 'hourly_rate' in 'field list'
-- Run this file once against the HRMS MySQL database.

ALTER TABLE `employees`
  ADD COLUMN `salary_type` ENUM('MONTHLY', 'HOURLY') NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN `monthly_salary` DECIMAL(12,2) NULL,
  ADD COLUMN `hourly_rate` DECIMAL(12,2) NULL,
  ADD COLUMN `overtime_hourly_rate` DECIMAL(12,2) NULL;

UPDATE `employees`
SET `monthly_salary` = `salary`
WHERE `monthly_salary` IS NULL;

ALTER TABLE `payroll_processing`
  ADD COLUMN `salary_type` ENUM('MONTHLY', 'HOURLY') NOT NULL DEFAULT 'MONTHLY',
  ADD COLUMN `hourly_rate` DECIMAL(12,2) NULL,
  ADD COLUMN `overtime_hourly_rate` DECIMAL(12,2) NULL,
  ADD COLUMN `total_worked_hours` DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN `normal_hours` DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN `overtime_hours` DECIMAL(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN `normal_pay` DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN `overtime_pay` DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Verify the required columns after applying the fix.
SHOW COLUMNS FROM `employees` WHERE `Field` IN
  ('salary_type', 'monthly_salary', 'hourly_rate', 'overtime_hourly_rate');

SHOW COLUMNS FROM `payroll_processing` WHERE `Field` IN
  ('salary_type', 'hourly_rate', 'overtime_hourly_rate',
   'total_worked_hours', 'normal_hours', 'overtime_hours',
   'normal_pay', 'overtime_pay');

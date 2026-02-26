-- Create employee_feedback table for anonymous feedback system
CREATE TABLE IF NOT EXISTS `employee_feedback` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `feedback` TEXT NOT NULL,
  `category` VARCHAR(50) DEFAULT 'general',
  `employeeId` INT,
  `employeeName` VARCHAR(255) NULL,
  `department` VARCHAR(100) NULL,
  `isAnonymous` TINYINT(1) DEFAULT 1,
  `companyId` INT NOT NULL,
  `status` ENUM('submitted', 'reviewed', 'resolved', 'dismissed') DEFAULT 'submitted',
  `createdAt` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX `idx_company` (`companyId`),
  INDEX `idx_status` (`status`),
  INDEX `idx_created` (`createdAt`),
  
  FOREIGN KEY (`employeeId`) REFERENCES `employees`(`id`) ON DELETE SET NULL,
  FOREIGN KEY (`companyId`) REFERENCES `company`(`id`) ON DELETE CASCADE
);

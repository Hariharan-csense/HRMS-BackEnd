-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id VARCHAR(36) PRIMARY KEY DEFAULT (UUID()),
  user_id VARCHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  type ENUM('success', 'warning', 'info', 'error') DEFAULT 'info',
  read BOOLEAN DEFAULT FALSE,
  module_id VARCHAR(36) NULL,
  action_url VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_user_read (user_id, read),
  INDEX idx_created_at (created_at)
);

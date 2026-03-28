-- Add storage_gb field to subscription_plans table
ALTER TABLE subscription_plans 
ADD COLUMN storage_gb INT DEFAULT 1 AFTER max_users;

-- Add storage tracking fields to company_subscriptions table
ALTER TABLE company_subscriptions 
ADD COLUMN storage_gb INT DEFAULT 1 AFTER max_users,
ADD COLUMN used_storage_mb INT DEFAULT 0 AFTER storage_gb;

-- Update existing subscription plans with appropriate storage values
UPDATE subscription_plans SET storage_gb = 2 WHERE name LIKE '%Basic%' OR name LIKE '%Starter%';
UPDATE subscription_plans SET storage_gb = 5 WHERE name LIKE '%Professional%' OR name LIKE '%Pro%';
UPDATE subscription_plans SET storage_gb = 10 WHERE name LIKE '%Enterprise%' OR name LIKE '%Premium%';

-- Update existing company subscriptions with storage from their plans
UPDATE company_subscriptions cs 
JOIN subscription_plans sp ON cs.plan_id = sp.id 
SET cs.storage_gb = sp.storage_gb;

-- Show the updated plans
SELECT id, name, price, max_users, storage_gb FROM subscription_plans ORDER BY price;

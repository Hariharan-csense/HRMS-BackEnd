const knex = require('../db/db');

const normalizeModuleKey = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const getAddonModuleAliases = (addon = {}) => {
  const key = normalizeModuleKey(addon.module_key || addon.moduleKey);
  const text = `${addon.name || ''} ${addon.description || ''}`.toLowerCase();
  const modules = new Set();

  if (key) modules.add(key);

  if (
    key === 'live_tracking' ||
    key === 'tracking_management' ||
    key === 'tracking' ||
    (text.includes('tracking') && !text.includes('applicant'))
  ) {
    modules.add('live_tracking');
  }

  if (key === 'client_attendance' || text.includes('client attendance') || text.includes('field attendance')) {
    modules.add('client_attendance');
    modules.add('client_attendance_admin');
    modules.add('my_clients');
    modules.add('my_analytics');
  }

  if (key === 'expenses' || text.includes('expense')) modules.add('expenses');
  if (key === 'tickets' || text.includes('ticket')) modules.add('tickets');
  if (key === 'assets' || text.includes('asset')) modules.add('assets');
  if (key === 'payroll' || text.includes('payroll')) modules.add('payroll');
  if (key === 'hr_management' || text.includes('recruitment') || text.includes('rms')) modules.add('hr_management');
  if (key === 'exit' || text.includes('offboarding')) modules.add('exit');

  return modules;
};

const getActiveAddonRowsForCompany = async (companyId, trx = knex) => {
  if (!companyId) return [];

  const hasCompanyAddons = await trx.schema.hasTable('company_subscription_addons');
  const hasAddons = await trx.schema.hasTable('subscription_addons');
  if (!hasCompanyAddons || !hasAddons) return [];

  const addonColumns = await trx('subscription_addons').columnInfo();
  const moduleKeySelect = addonColumns.module_key
    ? 'subscription_addons.module_key'
    : trx.raw('NULL as module_key');

  return trx('company_subscriptions')
    .join('company_subscription_addons', 'company_subscriptions.id', 'company_subscription_addons.subscription_id')
    .join('subscription_addons', 'company_subscription_addons.addon_id', 'subscription_addons.id')
    .where('company_subscriptions.company_id', companyId)
    .whereIn('company_subscriptions.status', ['trial', 'active'])
    .where('subscription_addons.is_active', true)
    .select(
      'company_subscription_addons.id as subscription_addon_id',
      'company_subscription_addons.addon_id',
      'company_subscription_addons.users_count',
      'subscription_addons.name',
      'subscription_addons.description',
      moduleKeySelect
    );
};

const companyHasActiveAddonModule = async (companyId, moduleKey, trx = knex) => {
  const wanted = normalizeModuleKey(moduleKey);
  const addonRows = await getActiveAddonRowsForCompany(companyId, trx);
  return addonRows.some((addon) => getAddonModuleAliases(addon).has(wanted));
};

const employeeHasAddonModuleAssignment = async (companyId, employeeId, moduleKey, trx = knex) => {
  if (!companyId || !employeeId) return false;

  const hasAssignments = await trx.schema.hasTable('company_addon_user_assignments');
  if (!hasAssignments) return false;

  const wanted = normalizeModuleKey(moduleKey);
  const addonColumns = await trx('subscription_addons').columnInfo();
  const moduleKeySelect = addonColumns.module_key
    ? 'subscription_addons.module_key'
    : trx.raw('NULL as module_key');

  const assignments = await trx('company_addon_user_assignments')
    .leftJoin('subscription_addons', 'company_addon_user_assignments.addon_id', 'subscription_addons.id')
    .where({
      'company_addon_user_assignments.company_id': companyId,
      'company_addon_user_assignments.employee_id': employeeId,
    })
    .select(
      'company_addon_user_assignments.module_key as assigned_module_key',
      'subscription_addons.name',
      'subscription_addons.description',
      moduleKeySelect
    );

  return assignments.some((assignment) => {
    if (normalizeModuleKey(assignment.assigned_module_key) === wanted) return true;
    return getAddonModuleAliases(assignment).has(wanted);
  });
};

module.exports = {
  normalizeModuleKey,
  getAddonModuleAliases,
  getActiveAddonRowsForCompany,
  companyHasActiveAddonModule,
  employeeHasAddonModuleAssignment,
};

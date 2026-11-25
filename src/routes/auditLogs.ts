import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { listAuditLogs } from '../db.js';

export const auditLogsRouter = Router();
auditLogsRouter.use(requireAuth, requireRole('superadmin'));

auditLogsRouter.get('/', (req, res) => {
  const action = req.query.action ? String(req.query.action) : undefined;
  const search = req.query.search ? String(req.query.search) : undefined;
  res.json({ logs: listAuditLogs({ action, search, limit: 300 }) });
});

auditLogsRouter.get('/export/csv', (_req, res) => {
  const rows = listAuditLogs({ limit: 1000 });
  const header = 'ID,AdminUsername,AdminName,Role,Action,Target,Details,CreatedAt';
  const lines = rows.map((r) =>
    [
      r.id,
      r.admin_username,
      `"${r.admin_name.replace(/"/g, '""')}"`,
      r.admin_role,
      r.action,
      `"${r.target.replace(/"/g, '""')}"`,
      `"${r.details.replace(/"/g, '""')}"`,
      r.created_at,
    ].join(',')
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="humas-audit-logs.csv"');
  res.send([header, ...lines].join('\n'));
});


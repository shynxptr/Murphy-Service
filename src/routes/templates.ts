import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { createTemplate, deleteTemplate, listTemplates, updateTemplate } from '../db.js';
import type { ConversationCategory } from '../types.js';

export const templatesRouter = Router();
templatesRouter.use(requireAuth);

templatesRouter.get('/', (_req, res) => {
  res.json({ templates: listTemplates() });
});

templatesRouter.post('/', requireRole('superadmin'), (req, res) => {
  const { name, category, content } = req.body as {
    name?: string;
    category?: ConversationCategory;
    content?: string;
  };
  if (!name?.trim() || !content?.trim()) {
    res.status(400).json({ error: 'Nama template dan isi pesan wajib diisi.' });
    return;
  }
  try {
    const template = createTemplate(name.trim(), category || 'general', content.trim());
    res.status(201).json({ template });
  } catch (err) {
    res.status(400).json({ error: 'Nama template sudah ada atau tidak valid.' });
  }
});

templatesRouter.put('/:id', requireRole('superadmin'), (req, res) => {
  const id = Number(req.params.id);
  const { name, category, content } = req.body as {
    name?: string;
    category?: ConversationCategory;
    content?: string;
  };
  if (!name?.trim() || !content?.trim()) {
    res.status(400).json({ error: 'Nama template dan isi pesan wajib diisi.' });
    return;
  }
  const template = updateTemplate(id, name.trim(), category || 'general', content.trim());
  if (!template) {
    res.status(404).json({ error: 'Template tidak ditemukan.' });
    return;
  }
  res.json({ template });
});

templatesRouter.delete('/:id', requireRole('superadmin'), (req, res) => {
  deleteTemplate(Number(req.params.id));
  res.json({ ok: true });
});

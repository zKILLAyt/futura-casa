import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const app = createApp();
const port = Number(process.env.PORT ?? 4000);

if (process.env.NODE_ENV === 'production') {
  const currentFile = fileURLToPath(import.meta.url);
  const distDirectory = path.resolve(path.dirname(currentFile), '../dist');
  app.use(express.static(distDirectory));
  app.get('*', (_req, res) => res.sendFile(path.join(distDirectory, 'index.html')));
}

app.listen(port, () => console.log(`Futura Casa API disponível na porta ${port}.`));

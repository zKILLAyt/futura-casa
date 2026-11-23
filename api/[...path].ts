import { createApp } from '../server/app.js';
import { createVercelApiHandler } from '../server/vercel-handler.js';

const app = createApp();

// The Vercel rewrite records the original path in a query parameter; restore
// it before Express matches the existing /api/... route definitions.
export default createVercelApiHandler(app);

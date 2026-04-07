import { Router, Request, Response } from 'express';
import { execSync } from 'child_process';

const router = Router();

let ffmpegAvailable = false;
try {
  execSync('ffmpeg -version', { stdio: 'ignore' });
  ffmpegAvailable = true;
} catch {
  ffmpegAvailable = false;
}

router.get('/api/export/status', (_req: Request, res: Response) => {
  res.json({ ffmpegAvailable });
});

export default router;

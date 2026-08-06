/**
 * api/[...path].js
 *
 * Single catch-all serverless function. Vercel's Hobby plan caps deployments
 * at 12 serverless functions; this project previously had 16 files directly
 * under api/, each becoming its own function. Consolidating into one
 * catch-all function + a static route table keeps the deployment to exactly
 * 1 function while preserving every existing /api/* URL unchanged.
 *
 * All actual handler logic lives under handlers/ (unchanged from its
 * previous location under api/) and is imported statically below -- static
 * imports are required (not a runtime dynamic import() with a computed
 * path) so Vercel's build-time bundler can trace and include every handler
 * file in the deployment.
 *
 * For a catch-all route file named [...path].js, Vercel's Node.js runtime
 * populates req.query.path as an array of the path segments after /api/
 * (e.g. /api/members/abc123 -> req.query.path === ['members', 'abc123']).
 */

import allHandler from '../handlers/all.js';
import publicJobsHandler from '../handlers/public-jobs.js';
import publicDataHandler from '../handlers/public-data.js';
import hrAuthHandler from '../handlers/hr-auth.js';
import memberLoginHandler from '../handlers/member-login.js';
import memberLogoutHandler from '../handlers/member-logout.js';
import meHandler from '../handlers/me.js';
import membersIndex from '../handlers/members/index.js';
import membersId from '../handlers/members/[id].js';
import membersIdLists from '../handlers/members/[id]/lists.js';
import holidays from '../handlers/holidays.js';
import jobsIndex from '../handlers/jobs/index.js';
import jobsId from '../handlers/jobs/[id].js';
import jobsIdCandidates from '../handlers/jobs/[id]/candidates.js';
import candidatesId from '../handlers/candidates/[id].js';
import okrsIndex from '../handlers/okrs/index.js';
import okrsId from '../handlers/okrs/[id].js';
import myGoalsIndex from '../handlers/my-goals/index.js';
import myGoalsId from '../handlers/my-goals/[id].js';
import okrTasksIndex from '../handlers/okr-tasks/index.js';
import okrTasksId from '../handlers/okr-tasks/[id].js';
import evalsIndex from '../handlers/evals/index.js';
import evalsId from '../handlers/evals/[id].js';
import calibrationOverrides from '../handlers/calibration/[quarter]/overrides.js';
import oneononesIndex from '../handlers/oneonones/index.js';

const ROUTES = [
  { pattern: ['all'], handler: allHandler },
  { pattern: ['public-jobs'], handler: publicJobsHandler },
  { pattern: ['public-data'], handler: publicDataHandler },
  { pattern: ['hr-auth'], handler: hrAuthHandler },
  { pattern: ['member-login'], handler: memberLoginHandler },
  { pattern: ['member-logout'], handler: memberLogoutHandler },
  { pattern: ['me'], handler: meHandler },
  { pattern: ['members'], handler: membersIndex },
  { pattern: ['members', ':id'], handler: membersId },
  { pattern: ['members', ':id', 'lists'], handler: membersIdLists },
  { pattern: ['holidays'], handler: holidays },
  { pattern: ['jobs'], handler: jobsIndex },
  { pattern: ['jobs', ':id'], handler: jobsId },
  { pattern: ['jobs', ':id', 'candidates'], handler: jobsIdCandidates },
  { pattern: ['candidates', ':id'], handler: candidatesId },
  { pattern: ['okrs'], handler: okrsIndex },
  { pattern: ['okrs', ':id'], handler: okrsId },
  { pattern: ['my-goals'], handler: myGoalsIndex },
  { pattern: ['my-goals', ':id'], handler: myGoalsId },
  { pattern: ['okr-tasks'], handler: okrTasksIndex },
  { pattern: ['okr-tasks', ':id'], handler: okrTasksId },
  { pattern: ['evals'], handler: evalsIndex },
  { pattern: ['evals', ':id'], handler: evalsId },
  { pattern: ['calibration', ':quarter', 'overrides'], handler: calibrationOverrides },
  { pattern: ['oneonones'], handler: oneononesIndex },
];

function matchRoute(segments) {
  for (const route of ROUTES) {
    if (route.pattern.length !== segments.length) continue;
    let ok = true;
    const params = {};
    for (let i = 0; i < route.pattern.length; i++) {
      const p = route.pattern[i];
      if (p.startsWith(':')) params[p.slice(1)] = segments[i];
      else if (p !== segments[i]) { ok = false; break; }
    }
    if (ok) return { handler: route.handler, params };
  }
  return null;
}

export default async function handler(req, res) {
  // Derive segments directly from the URL path rather than req.query's
  // catch-all key (observed to be inconsistently named across Vercel
  // runtime versions -- sometimes "path", sometimes "...path"). Parsing
  // the URL ourselves is robust regardless of that naming.
  const pathname = (req.url || '').split('?')[0];
  const segments = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const match = matchRoute(segments);
  if (!match) return res.status(404).json({ error: 'Not found' });
  Object.assign(req.query, match.params);
  return match.handler(req, res);
}
